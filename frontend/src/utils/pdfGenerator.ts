// Client-side PDF generation for offline mode
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const ITALIAN_MONTHS = [
  'gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno',
  'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'
];

const ITALIAN_DAYS = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];

interface TimesheetRow {
  commessa: string;
  hours: number[];
}

// Get number of days in month
const getDaysInMonth = (month: number, year: number): number => {
  return new Date(year, month, 0).getDate();
};

// Get day of week (0 = Sunday)
const getDayOfWeek = (day: number, month: number, year: number): number => {
  return new Date(year, month - 1, day).getDay();
};

// Format hours
const formatHours = (hours: number): string => {
  if (!hours || hours === 0) return '';
  return hours.toString().replace('.', ',');
};

// Generate Timesheet PDF (Landscape A4)
export const generateTimesheetPDF = (
  userName: string,
  month: number,
  year: number,
  rows: TimesheetRow[]
): { blob: Blob; filename: string } => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const numDays = getDaysInMonth(month, year);
  const monthName = ITALIAN_MONTHS[month - 1];

  // Title - User name
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(userName.toUpperCase(), pageWidth / 2, 15, { align: 'center' });

  // Month and Year
  doc.setFontSize(14);
  doc.setTextColor(200, 0, 0);
  doc.text(`${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`, pageWidth / 2, 23, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  // Filter rows with hours > 0
  const activeRows = rows.filter(row => {
    const total = row.hours.slice(0, numDays).reduce((sum, h) => sum + (h || 0), 0);
    return total > 0;
  });

  // Build table headers
  const headers = ['Commessa'];
  for (let d = 1; d <= numDays; d++) {
    const dayOfWeek = getDayOfWeek(d, month, year);
    headers.push(`${d}\n${ITALIAN_DAYS[dayOfWeek]}`);
  }
  headers.push('TOT');

  // Build table data
  const tableData: (string | number)[][] = [];
  let grandTotal = 0;

  activeRows.forEach(row => {
    const rowData: (string | number)[] = [row.commessa];
    let rowTotal = 0;
    
    for (let d = 0; d < numDays; d++) {
      const h = row.hours[d] || 0;
      rowData.push(h > 0 ? formatHours(h) : '');
      rowTotal += h;
    }
    
    rowData.push(formatHours(rowTotal));
    grandTotal += rowTotal;
    tableData.push(rowData);
  });

  // Add total row
  const totalRow: (string | number)[] = ['TOTALE'];
  for (let d = 0; d < numDays; d++) {
    const dayTotal = activeRows.reduce((sum, row) => sum + (row.hours[d] || 0), 0);
    totalRow.push(dayTotal > 0 ? formatHours(dayTotal) : '');
  }
  totalRow.push(formatHours(grandTotal));
  tableData.push(totalRow);

  // Calculate column widths
  const commessaWidth = 40;
  const totalWidth = 15;
  const availableWidth = pageWidth - 10 - commessaWidth - totalWidth;
  const dayWidth = availableWidth / numDays;

  const columnStyles: any = {
    0: { cellWidth: commessaWidth, halign: 'left' }
  };
  for (let i = 1; i <= numDays; i++) {
    columnStyles[i] = { cellWidth: dayWidth, halign: 'center', fontSize: 7 };
  }
  columnStyles[numDays + 1] = { cellWidth: totalWidth, halign: 'center', fontStyle: 'bold' };

  // Generate table
  autoTable(doc, {
    head: [headers],
    body: tableData,
    startY: 28,
    margin: { left: 5, right: 5 },
    styles: {
      fontSize: 7,
      cellPadding: 1,
      valign: 'middle'
    },
    headStyles: {
      fillColor: [25, 118, 210],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 6
    },
    columnStyles,
    didParseCell: (data) => {
      // Style weekend columns
      if (data.section === 'body' && data.column.index > 0 && data.column.index <= numDays) {
        const day = data.column.index;
        const dayOfWeek = getDayOfWeek(day, month, year);
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          data.cell.styles.fillColor = [255, 235, 238];
        }
      }
      // Style total row
      if (data.section === 'body' && data.row.index === tableData.length - 1) {
        data.cell.styles.fillColor = [230, 81, 0];
        data.cell.styles.textColor = 255;
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  const blob = doc.output('blob');
  const filename = `timesheet_${monthName}_${year}.pdf`;

  return { blob, filename };
};

// Generate Summary PDF (Portrait A4)
export const generateSummaryPDF = (
  userName: string,
  month: number,
  year: number,
  rows: TimesheetRow[]
): { blob: Blob; filename: string } => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const numDays = getDaysInMonth(month, year);
  const monthName = ITALIAN_MONTHS[month - 1];

  // Try to add logo
  // Logo will be added as base64 if needed

  // Title
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(25, 118, 210);
  doc.text('RIEPILOGO ORE', pageWidth / 2, 30, { align: 'center' });

  // User name
  doc.setFontSize(14);
  doc.setTextColor(0, 0, 0);
  doc.text(userName.toUpperCase(), pageWidth / 2, 40, { align: 'center' });

  // Month and Year
  doc.setFontSize(16);
  doc.setTextColor(230, 81, 0);
  doc.setFont('helvetica', 'bold');
  doc.text(`${monthName.charAt(0).toUpperCase() + monthName.slice(1)} ${year}`, pageWidth / 2, 50, { align: 'center' });
  doc.setTextColor(0, 0, 0);

  // Calculate totals per commessa
  const commessaTotals: { [key: string]: number } = {};
  let grandTotal = 0;

  rows.forEach(row => {
    const total = row.hours.slice(0, numDays).reduce((sum, h) => sum + (h || 0), 0);
    if (total > 0) {
      commessaTotals[row.commessa] = (commessaTotals[row.commessa] || 0) + total;
      grandTotal += total;
    }
  });

  // Build table data
  const tableData = Object.entries(commessaTotals)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([commessa, total]) => [commessa, formatHours(total)]);

  // Add grand total
  tableData.push(['TOTALE GENERALE', formatHours(grandTotal)]);

  if (tableData.length > 1) {
    // Generate table
    autoTable(doc, {
      head: [['COMMESSA', 'ORE TOTALI']],
      body: tableData,
      startY: 60,
      margin: { left: 30, right: 30 },
      styles: {
        fontSize: 11,
        cellPadding: 5,
        valign: 'middle'
      },
      headStyles: {
        fillColor: [25, 118, 210],
        textColor: 255,
        fontStyle: 'bold',
        halign: 'center'
      },
      columnStyles: {
        0: { halign: 'left', cellWidth: 110 },
        1: { halign: 'center', cellWidth: 40 }
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245]
      },
      didParseCell: (data) => {
        // Style total row
        if (data.section === 'body' && data.row.index === tableData.length - 1) {
          data.cell.styles.fillColor = [230, 81, 0];
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = 'bold';
        }
      }
    });
  } else {
    doc.setFontSize(14);
    doc.setTextColor(128, 128, 128);
    doc.setFont('helvetica', 'italic');
    doc.text('Nessuna ora registrata per questo mese', pageWidth / 2, 80, { align: 'center' });
  }

  // Footer with date
  const now = new Date();
  const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  doc.setFontSize(9);
  doc.setTextColor(128, 128, 128);
  doc.setFont('helvetica', 'normal');
  doc.text(`Documento generato il ${dateStr}`, pageWidth / 2, 280, { align: 'center' });

  const blob = doc.output('blob');
  const filename = `riepilogo_${monthName}_${year}.pdf`;

  return { blob, filename };
};

// Open PDF in new window for preview
export const previewPDF = (blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
};

// Print PDF
export const printPDF = (blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
    }, 500);
  };
};

// Share PDF (using Web Share API)
export const sharePDF = async (blob: Blob, filename: string, title: string): Promise<boolean> => {
  const file = new File([blob], filename, { type: 'application/pdf' });
  
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: title,
      });
      return true;
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Share error:', error);
      }
      return false;
    }
  }
  
  // Fallback: download the file
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
  return true;
};
