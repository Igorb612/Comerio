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

# Employee info - fixed
EMPLOYEE_NAME = "Igor Martignoni"
MATRICOLA = "546"
CURRENT_YEAR = 2025

# Italian day names
ITALIAN_DAYS = ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"]
ITALIAN_MONTHS = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"
]

# Models
class TimesheetRow(BaseModel):
    commessa: str
    hours: List[float]  # 31 elements for max days in month

class TimesheetCreate(BaseModel):
    month: int  # 1-12
    rows: List[TimesheetRow]

class TimesheetUpdate(BaseModel):
    rows: List[TimesheetRow]

class Timesheet(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    month: int
    year: int = CURRENT_YEAR
    employee_name: str = EMPLOYEE_NAME
    matricola: str = MATRICOLA
    rows: List[TimesheetRow]
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class CommessaCreate(BaseModel):
    name: str

class Commessa(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: datetime = Field(default_factory=datetime.utcnow)

# Routes
@api_router.get("/")
async def root():
    return {"message": "Timesheet API", "employee": EMPLOYEE_NAME, "matricola": MATRICOLA}

@api_router.get("/info")
async def get_info():
    return {
        "employee_name": EMPLOYEE_NAME,
        "matricola": MATRICOLA,
        "current_year": CURRENT_YEAR,
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
    result = await db.commesse.delete_one({"id": commessa_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Commessa not found")
    return {"message": "Commessa deleted"}

# Timesheet endpoints
@api_router.get("/timesheets", response_model=List[Timesheet])
async def get_timesheets():
    timesheets = await db.timesheets.find({"year": CURRENT_YEAR}).sort("month", 1).to_list(100)
    return [Timesheet(**t) for t in timesheets]

@api_router.get("/timesheets/{month}", response_model=Optional[Timesheet])
async def get_timesheet(month: int):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    
    timesheet = await db.timesheets.find_one({"month": month, "year": CURRENT_YEAR})
    if timesheet:
        return Timesheet(**timesheet)
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
    
    # Check if timesheet exists
    existing = await db.timesheets.find_one({"month": input.month, "year": CURRENT_YEAR})
    
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
        return Timesheet(**existing)
    else:
        # Create new
        timesheet = Timesheet(
            month=input.month,
            rows=input.rows
        )
        await db.timesheets.insert_one(timesheet.dict())
        return timesheet

@api_router.delete("/timesheets/{month}")
async def delete_timesheet(month: int):
    result = await db.timesheets.delete_one({"month": month, "year": CURRENT_YEAR})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Timesheet not found")
    return {"message": "Timesheet deleted"}

# PDF Generation
def get_days_in_month(month: int, year: int = CURRENT_YEAR):
    return calendar.monthrange(year, month)[1]

def get_day_of_week(day: int, month: int, year: int = CURRENT_YEAR):
    """Returns 0=Monday, 6=Sunday"""
    return calendar.weekday(year, month, day)

@api_router.get("/timesheets/{month}/pdf")
async def generate_pdf(month: int):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    
    timesheet = await db.timesheets.find_one({"month": month, "year": CURRENT_YEAR})
    
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
    employee_name_upper = f"{EMPLOYEE_NAME.upper()}  {MATRICOLA}"
    
    elements.append(Paragraph(f"<b>{employee_name_upper}</b>", name_style))
    elements.append(Paragraph(f"<b>{month_name} {CURRENT_YEAR}</b>", month_style))
    
    # Calculate days
    num_days = get_days_in_month(month)
    
    # Build table header
    # Row 1: Day names (Lu, Ma, etc.)
    day_names_row = [""]
    for day in range(1, num_days + 1):
        dow = get_day_of_week(day, month)
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
        dow = get_day_of_week(day, month)
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
        "filename": f"timesheet_{month_name}_{CURRENT_YEAR}.pdf"
    }

@api_router.get("/timesheets/{month}/pdf/download")
async def download_pdf(month: int):
    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Invalid month")
    
    result = await generate_pdf(month)
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
