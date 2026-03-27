from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
import uuid
from datetime import datetime
import calendar
from io import BytesIO
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm, cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import base64

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Italian day names
ITALIAN_DAYS = ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"]
ITALIAN_MONTHS = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"
]

# Models
class UserCreate(BaseModel):
    name: str

class User(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

class TimesheetRow(BaseModel):
    commessa: str
    hours: List[float]  # 31 elements for max days in month

class TimesheetCreate(BaseModel):
    user_id: str
    month: int  # 1-12
    year: int  # Anno
    rows: List[TimesheetRow]

class TimesheetUpdate(BaseModel):
    rows: List[TimesheetRow]

class Timesheet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str = Field(default="default")  # Default user for backwards compatibility
    month: int
    year: int
    rows: List[TimesheetRow]
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class CommessaCreate(BaseModel):
    name: str

class Commessa(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

# User endpoints
@api_router.get("/users", response_model=List[User])
async def get_users():
    users = await db.users.find().sort("name", 1).to_list(1000)
    return [User(**u) for u in users]

@api_router.post("/users", response_model=User)
async def create_user(input: UserCreate):
    # Check if already exists
    existing = await db.users.find_one({"name": input.name})
    if existing:
        return User(**existing)
    
    user = User(name=input.name)
    await db.users.insert_one(user.dict())
    return user

@api_router.get("/users/{user_id}", response_model=Optional[User])
async def get_user(user_id: str):
    user = await db.users.find_one({"id": user_id})
    if user:
        return User(**user)
    return None

@api_router.delete("/users/{user_id}")
async def delete_user(user_id: str):
    # First check if user exists
    user = await db.users.find_one({"id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    user_name = user["name"]
    
    # Delete user
    await db.users.delete_one({"id": user_id})
    
    # Also delete all timesheets for this user
    await db.timesheets.delete_many({"user_id": user_id})
    
    return {"message": f"Utente '{user_name}' e tutti i suoi timesheet eliminati"}

# Routes
@api_router.get("/")
async def root():
    return {"message": "Timesheet API Multi-User"}

@api_router.get("/info")
async def get_info():
    current_year = datetime.now().year
    return {
        "current_year": current_year,
        "months": ITALIAN_MONTHS
    }

# Commesse endpoints
@api_router.get("/commesse", response_model=List[Commessa])
async def get_commesse():
    commesse = await db.commesse.find().sort("name", 1).to_list(1000)
    return [Commessa(**c) for c in commesse]

@api_router.post("/commesse", response_model=Commessa)
async def create_commessa(input: CommessaCreate):
    # Check if already exists
    existing = await db.commesse.find_one({"name": input.name})
    if existing:
        return Commessa(**existing)
    
    commessa = Commessa(name=input.name)
    await db.commesse.insert_one(commessa.dict())
    return commessa

@api_router.delete("/commesse/{commessa_id}")
async def delete_commessa(commessa_id: str):
    # First get the commessa name
    commessa = await db.commesse.find_one({"id": commessa_id})
    if not commessa:
        raise HTTPException(status_code=404, detail="Commessa not found")
    
    commessa_name = commessa["name"]
    
    # Delete the commessa
    await db.commesse.delete_one({"id": commessa_id})
    
    # Remove all rows with this commessa from all timesheets
    timesheets = await db.timesheets.find({}).to_list(1000)
    for timesheet in timesheets:
        # Filter out rows with this commessa
        original_rows = timesheet.get("rows", [])
        filtered_rows = [row for row in original_rows if row.get("commessa") != commessa_name]
        
        # Update timesheet if rows changed
        if len(filtered_rows) != len(original_rows):
            await db.timesheets.update_one(
                {"id": timesheet["id"]},
                {"$set": {"rows": filtered_rows, "updated_at": datetime.utcnow()}}
            )
    
    return {"message": f"Commessa '{commessa_name}' e tutti i dati relativi eliminati"}

# Timesheet endpoints - now per user
@api_router.get("/timesheets", response_model=List[Timesheet])
async def get_timesheets(user_id: Optional[str] = None, year: Optional[int] = None):
    query = {}
    if user_id:
        query["user_id"] = user_id
    if year:
        query["year"] = year
    timesheets = await db.timesheets.find(query).sort([("year", -1), ("month", 1)]).to_list(100)
    return [Timesheet(**{**t, "user_id": t.get("user_id", "default")}) for t in timesheets]

@api_router.get("/timesheets/{user_id}/{year}/{month}", response_model=Optional[Timesheet])
async def get_timesheet(user_id: str, year: int, month: int):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    
    timesheet = await db.timesheets.find_one({"user_id": user_id, "month": month, "year": year})
    if timesheet:
        return Timesheet(**{**timesheet, "user_id": timesheet.get("user_id", "default")})
    return None

@api_router.post("/timesheets", response_model=Timesheet)
async def create_or_update_timesheet(input: TimesheetCreate):
    if input.month < 1 or input.month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    
    # Save new commesse
    for row in input.rows:
        if row.commessa.strip():
            existing = await db.commesse.find_one({"name": row.commessa})
            if not existing:
                commessa = Commessa(name=row.commessa)
                await db.commesse.insert_one(commessa.dict())
    
    # Check if timesheet exists for this user/month/year
    existing = await db.timesheets.find_one({
        "user_id": input.user_id,
        "month": input.month, 
        "year": input.year
    })
    
    if existing:
        # Update
        update_data = {
            "rows": [r.dict() for r in input.rows],
            "updated_at": datetime.utcnow()
        }
        await db.timesheets.update_one(
            {"id": existing["id"]},
            {"$set": update_data}
        )
        existing.update(update_data)
        return Timesheet(**{**existing, "user_id": existing.get("user_id", "default")})
    else:
        # Create new
        timesheet = Timesheet(
            user_id=input.user_id,
            month=input.month,
            year=input.year,
            rows=input.rows
        )
        await db.timesheets.insert_one(timesheet.dict())
        return timesheet

@api_router.delete("/timesheets/{user_id}/{year}/{month}")
async def delete_timesheet(user_id: str, year: int, month: int):
    result = await db.timesheets.delete_one({"user_id": user_id, "month": month, "year": year})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    return {"message": "Timesheet deleted"}

# PDF Generation
def get_days_in_month(month: int, year: int):
    return calendar.monthrange(year, month)[1]

def get_day_of_week(day: int, month: int, year: int):
    """Returns 0=Monday, 6=Sunday"""
    return calendar.weekday(year, month, day)

@api_router.get("/timesheets/{user_id}/{year}/{month}/pdf")
async def generate_pdf(user_id: str, year: int, month: int):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    
    # Get user info
    user = await db.users.find_one({"id": user_id})
    user_name = user["name"] if user else "Utente"
    
    timesheet = await db.timesheets.find_one({"user_id": user_id, "month": month, "year": year})
    
    # Create PDF buffer
    buffer = BytesIO()
    
    # A4 Landscape
    doc = SimpleDocTemplate(
        buffer,
        pagesize=landscape(A4),
        leftMargin=5*mm,
        rightMargin=5*mm,
        topMargin=10*mm,
        bottomMargin=10*mm
    )
    
    elements = []
    styles = getSampleStyleSheet()
    
    # Employee name style - uppercase, centered, bold
    name_style = ParagraphStyle(
        'EmployeeName',
        parent=styles['Heading1'],
        fontSize=18,
        alignment=1,  # Center
        spaceAfter=2*mm,
        textColor=colors.black,
        fontName='Helvetica-Bold'
    )
    
    # Month style - centered, smaller, red
    month_style = ParagraphStyle(
        'MonthTitle',
        parent=styles['Normal'],
        fontSize=14,
        alignment=1,  # Center
        spaceAfter=8*mm,
        textColor=colors.red,
        fontName='Helvetica-Bold'
    )
    
    # Header with employee name (uppercase) and month
    month_name = ITALIAN_MONTHS[month - 1].capitalize()
    employee_name_upper = user_name.upper()
    
    elements.append(Paragraph(f"<b>{employee_name_upper}</b>", name_style))
    elements.append(Paragraph(f"<b>{month_name} {year}</b>", month_style))
    
    # Calculate days
    num_days = get_days_in_month(month, year)
    
    # Build table header
    # Row 1: Day names (Lu, Ma, etc.)
    day_names_row = [""]
    for day in range(1, num_days + 1):
        dow = get_day_of_week(day, month, year)
        day_names_row.append(ITALIAN_DAYS[dow])
    day_names_row.append("Tot. Ore")
    
    # Row 2: Day numbers
    day_numbers_row = ["COMMESSA"]
    for day in range(1, num_days + 1):
        day_numbers_row.append(f"{day:02d}")
    day_numbers_row.append("")
    
    # Data rows - only include rows with actual data
    data_rows = []
    daily_totals = [0.0] * num_days
    
    if timesheet and timesheet.get("rows"):
        for row in timesheet["rows"]:
            # Check if row has any hours > 0
            row_total = sum(h for h in row["hours"][:num_days] if h and h > 0)
            if row_total == 0:
                continue  # Skip empty rows
                
            row_data = [row["commessa"]]
            for i, hours in enumerate(row["hours"][:num_days]):
                if hours and hours > 0:
                    # Format with comma for Italian
                    formatted = str(hours).replace('.', ',')
                    row_data.append(formatted)
                    daily_totals[i] += hours
                else:
                    row_data.append("")
            # Fill remaining days if less than num_days
            while len(row_data) < num_days + 1:
                row_data.append("")
            # Total hours for this row - show only if > 0
            row_data.append(str(row_total).replace('.', ',') if row_total > 0 else "")
            data_rows.append(row_data)
    
    # NO empty rows - only show actual data
    
    # Daily totals row - show empty instead of 0
    totals_row = [""]
    grand_total = 0.0
    for total in daily_totals:
        if total > 0:
            totals_row.append(str(total).replace('.', ','))
            grand_total += total
        else:
            totals_row.append("")
    totals_row.append(str(grand_total).replace('.', ',') if grand_total > 0 else "")
    
    # Combine all rows
    table_data = [day_names_row, day_numbers_row] + data_rows + [totals_row]
    
    # Calculate column widths
    page_width = landscape(A4)[0] - 10*mm
    commessa_width = 50*mm
    total_col_width = 22*mm
    remaining_width = page_width - commessa_width - total_col_width
    day_col_width = remaining_width / num_days
    
    col_widths = [commessa_width] + [day_col_width] * num_days + [total_col_width]
    
    # Create table
    table = Table(table_data, colWidths=col_widths, repeatRows=2)
    
    # Table style
    style = TableStyle([
        # Header rows
        ('BACKGROUND', (0, 0), (-1, 1), colors.Color(0.9, 0.9, 0.9)),
        ('TEXTCOLOR', (0, 0), (-1, 1), colors.black),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('FONTNAME', (0, 0), (-1, 1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 7),
        ('FONTSIZE', (0, 1), (0, 1), 8),  # COMMESSA label bigger
        
        # Grid
        ('GRID', (0, 0), (-1, -1), 0.5, colors.black),
        
        # Commessa column - CENTERED
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('FONTSIZE', (0, 2), (0, -1), 7),
        
        # Totals column
        ('BACKGROUND', (-1, 0), (-1, -1), colors.Color(0.95, 0.95, 0.95)),
        ('FONTNAME', (-1, 2), (-1, -1), 'Helvetica-Bold'),
        
        # Bottom totals row
        ('BACKGROUND', (0, -1), (-1, -1), colors.Color(0.85, 0.85, 0.85)),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        
        # Row height
        ('ROWHEIGHTS', (0, 0), (-1, -1), 12),
    ])
    
    # Highlight weekends (Saturday and Sunday) in red
    for day in range(1, num_days + 1):
        dow = get_day_of_week(day, month, year)
        if dow >= 5:  # Saturday (5) or Sunday (6)
            col_idx = day  # +1 for commessa column, but day is 1-indexed so it equals out
            style.add('TEXTCOLOR', (col_idx, 1), (col_idx, 1), colors.red)
    
    table.setStyle(style)
    elements.append(table)
    
    # Build PDF
    doc.build(elements)
    
    # Get PDF data
    buffer.seek(0)
    pdf_data = buffer.getvalue()
    
    # Return as base64 for preview or as file for download
    return {
        "pdf_base64": base64.b64encode(pdf_data).decode('utf-8'),
        "filename": f"timesheet_{month_name}_{year}.pdf"
    }

@api_router.get("/timesheets/{user_id}/{year}/{month}/pdf/download")
async def download_pdf(user_id: str, year: int, month: int):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    
    result = await generate_pdf(user_id, year, month)
    pdf_data = base64.b64decode(result["pdf_base64"])
    
    return StreamingResponse(
        BytesIO(pdf_data),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={result['filename']}"}
    )

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
