import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  FlatList,
  Pressable,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

const API_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

// Types
interface TimesheetRow {
  commessa: string;
  hours: number[];
}

interface Timesheet {
  id: string;
  month: number;
  year: number;
  employee_name: string;
  matricola: string;
  rows: TimesheetRow[];
}

interface Commessa {
  id: string;
  name: string;
}

interface AppInfo {
  employee_name: string;
  matricola: string;
  current_year: number;
  months: string[];
}

interface DayEntry {
  day: number;
  commessa: string;
  hours: number;
}

const ITALIAN_DAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const ITALIAN_DAYS_SHORT = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'];
const ITALIAN_MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const getDaysInMonth = (month: number, year: number): number => {
  return new Date(year, month, 0).getDate();
};

const getDayOfWeekName = (day: number, month: number, year: number): string => {
  const date = new Date(year, month - 1, day);
  return ITALIAN_DAYS[date.getDay()];
};

const isWeekend = (day: number, month: number, year: number): boolean => {
  const date = new Date(year, month - 1, day);
  const dow = date.getDay();
  return dow === 0 || dow === 6;
};

export default function TimesheetApp() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [rows, setRows] = useState<TimesheetRow[]>([]);
  const [commesse, setCommesse] = useState<Commessa[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showCommessaPicker, setShowCommessaPicker] = useState(false);
  const [showDayPicker, setShowDayPicker] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archivedTimesheets, setArchivedTimesheets] = useState<Timesheet[]>([]);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Entry form state
  const [selectedDay, setSelectedDay] = useState<number>(new Date().getDate());
  const [selectedCommessa, setSelectedCommessa] = useState<string>('');
  const [hoursInput, setHoursInput] = useState<string>('');
  const [newCommessaInput, setNewCommessaInput] = useState('');

  // Available years (current year +/- 5)
  const currentRealYear = new Date().getFullYear();
  const availableYears = Array.from({ length: 11 }, (_, i) => currentRealYear - 5 + i);

  const numDays = getDaysInMonth(selectedMonth, selectedYear);

  // Fetch app info
  useEffect(() => {
    fetchAppInfo();
    fetchCommesse();
  }, []);

  // Fetch timesheet when month or year changes
  useEffect(() => {
    fetchTimesheet();
    // Reset selected day if it exceeds days in new month
    if (selectedDay > getDaysInMonth(selectedMonth, selectedYear)) {
      setSelectedDay(1);
    }
  }, [selectedMonth, selectedYear]);

  const fetchAppInfo = async () => {
    try {
      const response = await fetch(`${API_URL}/api/info`);
      const data = await response.json();
      setAppInfo(data);
    } catch (error) {
      console.error('Error fetching app info:', error);
    }
  };

  const fetchCommesse = async () => {
    try {
      const response = await fetch(`${API_URL}/api/commesse`);
      const data = await response.json();
      setCommesse(data);
    } catch (error) {
      console.error('Error fetching commesse:', error);
    }
  };

  const fetchTimesheet = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/timesheets/${selectedYear}/${selectedMonth}`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setRows(data.rows || []);
        } else {
          setRows([]);
        }
      } else {
        setRows([]);
      }
    } catch (error) {
      console.error('Error fetching timesheet:', error);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchArchivedTimesheets = async () => {
    try {
      const response = await fetch(`${API_URL}/api/timesheets`);
      const data = await response.json();
      setArchivedTimesheets(data);
    } catch (error) {
      console.error('Error fetching archived timesheets:', error);
    }
  };

  const saveTimesheet = async (newRows: TimesheetRow[]) => {
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/timesheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          year: selectedYear,
          rows: newRows.filter(r => r.commessa.trim() !== '')
        })
      });
      if (response.ok) {
        await fetchCommesse();
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error saving timesheet:', error);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const addEntry = async () => {
    if (!selectedCommessa.trim()) {
      Alert.alert('Errore', 'Seleziona una commessa');
      return;
    }
    
    const hours = parseFloat(hoursInput.replace(',', '.')) || 0;
    if (hours <= 0) {
      Alert.alert('Errore', 'Inserisci le ore lavorate');
      return;
    }

    // Find or create row for this commessa
    let newRows = [...rows];
    let rowIndex = newRows.findIndex(r => r.commessa === selectedCommessa);
    
    if (rowIndex === -1) {
      // Create new row
      newRows.push({
        commessa: selectedCommessa,
        hours: Array(31).fill(0)
      });
      rowIndex = newRows.length - 1;
    }

    // Update hours for the selected day
    newRows[rowIndex].hours[selectedDay - 1] = hours;
    
    // Save to backend
    const success = await saveTimesheet(newRows);
    if (success) {
      setRows(newRows);
      setHoursInput('');
      Alert.alert('Salvato', `${hours.toString().replace('.', ',')} ore per ${selectedCommessa} il giorno ${selectedDay}`);
    } else {
      Alert.alert('Errore', 'Errore durante il salvataggio');
    }
  };

  const removeEntry = async (commessa: string, day: number) => {
    Alert.alert(
      'Conferma',
      `Vuoi eliminare le ore di "${commessa}" del giorno ${day}?`,
      [
        { text: 'Annulla', style: 'cancel' },
        { 
          text: 'Elimina', 
          style: 'destructive', 
          onPress: async () => {
            let newRows = [...rows];
            const rowIndex = newRows.findIndex(r => r.commessa === commessa);
            if (rowIndex !== -1) {
              newRows[rowIndex].hours[day - 1] = 0;
              
              // Remove row if all hours are 0
              const totalHours = newRows[rowIndex].hours.reduce((sum, h) => sum + h, 0);
              if (totalHours === 0) {
                newRows = newRows.filter((_, i) => i !== rowIndex);
              }
              
              const success = await saveTimesheet(newRows);
              if (success) {
                setRows(newRows);
              }
            }
          }
        }
      ]
    );
  };

  // Get all entries for current month, sorted by day
  const getMonthEntries = (): DayEntry[] => {
    const entries: DayEntry[] = [];
    rows.forEach(row => {
      row.hours.forEach((hours, index) => {
        if (hours > 0 && index < numDays) {
          entries.push({
            day: index + 1,
            commessa: row.commessa,
            hours: hours
          });
        }
      });
    });
    return entries.sort((a, b) => a.day - b.day);
  };

  const calculateTotalHours = (): number => {
    return rows.reduce((sum, row) => {
      return sum + row.hours.slice(0, numDays).reduce((s, h) => s + h, 0);
    }, 0);
  };

  const formatHours = (value: number): string => {
    if (value === 0) return '0';
    return value.toString().replace('.', ',');
  };

  const handlePreviewPDF = async () => {
    setPdfLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/timesheets/${selectedYear}/${selectedMonth}/pdf`);
      const data = await response.json();
      
      if (data.pdf_base64) {
        if (Platform.OS === 'web') {
          const byteCharacters = atob(data.pdf_base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        } else {
          // For mobile, use print with orientation
          await Print.printAsync({
            uri: `data:application/pdf;base64,${data.pdf_base64}`,
            orientation: Print.Orientation.landscape,
          });
        }
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      Alert.alert('Errore', 'Errore durante la generazione del PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    setPdfLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/timesheets/${selectedYear}/${selectedMonth}/pdf`);
      const data = await response.json();
      
      if (data.pdf_base64) {
        if (Platform.OS === 'web') {
          // Download PDF directly
          const byteCharacters = atob(data.pdf_base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = data.filename;
          link.click();
        } else {
          // For mobile, save file and share
          if (await Sharing.isAvailableAsync()) {
            // Create file from base64
            const fileUri = `${FileSystem.cacheDirectory}${data.filename}`;
            await FileSystem.writeAsStringAsync(fileUri, data.pdf_base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            await Sharing.shareAsync(fileUri, {
              mimeType: 'application/pdf',
              dialogTitle: 'Salva o condividi il PDF',
            });
          } else {
            Alert.alert('Info', 'La condivisione non è disponibile su questo dispositivo');
          }
        }
      }
    } catch (error) {
      console.error('Error downloading PDF:', error);
      Alert.alert('Errore', 'Errore durante il download del PDF');
    } finally {
      setPdfLoading(false);
    }
  };

  // Generate HTML table for PDF
  const generatePdfHtml = () => {
    const daysInMonth = getDaysInMonth(selectedMonth, selectedYear);
    const monthName = ITALIAN_MONTHS[selectedMonth - 1];
    
    // Build day headers
    let dayNamesRow = '<th style="width:80px;background:#e0e0e0;padding:4px;font-size:8px;">COMMESSA</th>';
    let dayNumbersRow = '<th style="background:#e0e0e0;"></th>';
    
    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(selectedYear, selectedMonth - 1, d);
      const dayOfWeek = date.getDay();
      const dayNames = ['Do', 'Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa'];
      const isWeekendDay = dayOfWeek === 0 || dayOfWeek === 6;
      const color = isWeekendDay ? 'red' : 'black';
      
      dayNamesRow += `<th style="width:22px;background:#e0e0e0;padding:2px;font-size:7px;color:${color};">${dayNames[dayOfWeek]}</th>`;
      dayNumbersRow += `<th style="background:#e0e0e0;padding:2px;font-size:8px;color:${color};">${d.toString().padStart(2, '0')}</th>`;
    }
    dayNamesRow += '<th style="width:45px;background:#e0e0e0;padding:4px;font-size:8px;">Tot.Ore</th>';
    dayNumbersRow += '<th style="background:#e0e0e0;"></th>';
    
    // Build data rows - ONLY rows with actual data
    let dataRows = '';
    let dailyTotals = new Array(daysInMonth).fill(0);
    
    rows.forEach(row => {
      // Check if row has any hours
      const rowTotal = row.hours.slice(0, daysInMonth).reduce((sum, h) => sum + (h || 0), 0);
      if (rowTotal === 0 || !row.commessa.trim()) {
        return; // Skip empty rows
      }
      
      let rowHtml = `<td style="text-align:center;padding:3px;font-size:7px;border:1px solid #ccc;">${row.commessa}</td>`;
      
      for (let d = 0; d < daysInMonth; d++) {
        const hours = row.hours[d] || 0;
        const display = hours > 0 ? hours.toString().replace('.', ',') : '';
        rowHtml += `<td style="text-align:center;padding:2px;font-size:7px;border:1px solid #ccc;">${display}</td>`;
        dailyTotals[d] += hours;
      }
      
      // Total - show only if > 0
      rowHtml += `<td style="text-align:center;padding:3px;font-size:8px;font-weight:bold;border:1px solid #ccc;background:#f5f5f5;">${rowTotal > 0 ? rowTotal.toString().replace('.', ',') : ''}</td>`;
      dataRows += `<tr>${rowHtml}</tr>`;
    });
    
    // NO empty rows added
    
    // Build totals row - empty instead of 0
    let totalsRow = '<td style="text-align:center;padding:3px;font-size:8px;font-weight:bold;background:#d0d0d0;border:1px solid #999;">TOTALE</td>';
    let grandTotal = 0;
    for (let d = 0; d < daysInMonth; d++) {
      const total = dailyTotals[d];
      grandTotal += total;
      totalsRow += `<td style="text-align:center;padding:2px;font-size:7px;font-weight:bold;background:#d0d0d0;border:1px solid #999;">${total > 0 ? total.toString().replace('.', ',') : ''}</td>`;
    }
    totalsRow += `<td style="text-align:center;padding:3px;font-size:9px;font-weight:bold;background:#d0d0d0;border:1px solid #999;">${grandTotal > 0 ? grandTotal.toString().replace('.', ',') : ''}</td>`;
    
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page { size: A4 landscape; margin: 10mm; }
          body { font-family: Arial, sans-serif; margin: 0; padding: 10px; }
          h1 { text-align: center; font-size: 16px; margin: 5px 0; color: #000; }
          h2 { text-align: center; font-size: 12px; margin: 5px 0 15px 0; color: red; }
          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          th, td { border: 1px solid #999; }
        </style>
      </head>
      <body>
        <h1>${appInfo?.employee_name?.toUpperCase() || 'IGOR MARTIGNONI'}  ${appInfo?.matricola || '546'}</h1>
        <h2>${monthName} ${selectedYear}</h2>
        <table>
          <tr>${dayNamesRow}</tr>
          <tr>${dayNumbersRow}</tr>
          ${dataRows}
          <tr>${totalsRow}</tr>
        </table>
      </body>
      </html>
    `;
  };

  const handleShareWhatsApp = async () => {
    setPdfLoading(true);
    try {
      if (Platform.OS === 'web') {
        // For web, use backend PDF
        const response = await fetch(`${API_URL}/api/timesheets/${selectedYear}/${selectedMonth}/pdf`);
        const data = await response.json();
        
        if (data.pdf_base64) {
          const byteCharacters = atob(data.pdf_base64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'application/pdf' });
          
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = data.filename;
          link.click();
          
          setTimeout(() => {
            window.open('https://web.whatsapp.com/', '_blank');
            Alert.alert('PDF Scaricato', 'Allega il PDF scaricato nella chat WhatsApp.');
          }, 500);
        }
      } else {
        // For mobile - generate PDF locally with expo-print
        const html = generatePdfHtml();
        
        const { uri } = await Print.printToFileAsync({
          html: html,
          width: 842,  // A4 landscape width in points
          height: 595, // A4 landscape height in points
        });
        
        // Share the generated PDF
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: 'Invia Timesheet via WhatsApp',
        });
      }
    } catch (error) {
      console.error('Error sharing PDF:', error);
      Alert.alert('Errore', 'Errore durante la creazione del PDF. Riprova.');
    } finally {
      setPdfLoading(false);
    }
  };

  const selectCommessa = (commessa: string) => {
    setSelectedCommessa(commessa);
    setShowCommessaPicker(false);
    setNewCommessaInput('');
  };

  const deleteCommessa = async (commessa: Commessa) => {
    if (Platform.OS === 'web') {
      // Use window.confirm for web
      const confirmed = window.confirm(`Vuoi eliminare la commessa "${commessa.name}" e tutti i dati relativi?`);
      if (confirmed) {
        try {
          const response = await fetch(`${API_URL}/api/commesse/${commessa.id}`, {
            method: 'DELETE',
          });
          if (response.ok) {
            setCommesse(commesse.filter(c => c.id !== commessa.id));
            if (selectedCommessa === commessa.name) {
              setSelectedCommessa('');
            }
            // Reload timesheet data to reflect removed rows
            await fetchTimesheet();
            alert('Commessa e tutti i dati relativi eliminati');
          } else {
            alert('Errore durante l\'eliminazione');
          }
        } catch (error) {
          console.error('Error deleting commessa:', error);
          alert('Errore durante l\'eliminazione');
        }
      }
    } else {
      // Use Alert for mobile
      Alert.alert(
        'Elimina Commessa',
        `Vuoi eliminare la commessa "${commessa.name}" e tutti i dati relativi?`,
        [
          { text: 'Annulla', style: 'cancel' },
          {
            text: 'Elimina',
            style: 'destructive',
            onPress: async () => {
              try {
                const response = await fetch(`${API_URL}/api/commesse/${commessa.id}`, {
                  method: 'DELETE',
                });
                if (response.ok) {
                  setCommesse(commesse.filter(c => c.id !== commessa.id));
                  if (selectedCommessa === commessa.name) {
                    setSelectedCommessa('');
                  }
                  // Reload timesheet data to reflect removed rows
                  await fetchTimesheet();
                  Alert.alert('Eliminato', 'Commessa e tutti i dati relativi eliminati');
                } else {
                  Alert.alert('Errore', 'Errore durante l\'eliminazione');
                }
              } catch (error) {
                console.error('Error deleting commessa:', error);
                Alert.alert('Errore', 'Errore durante l\'eliminazione');
              }
            }
          }
        ]
      );
    }
  };

  const addNewCommessa = () => {
    if (newCommessaInput.trim()) {
      selectCommessa(newCommessaInput.trim());
    }
  };

  const openArchive = () => {
    fetchArchivedTimesheets();
    setShowArchive(true);
  };

  const selectArchivedTimesheet = (month: number) => {
    setSelectedMonth(month);
    setShowArchive(false);
  };

  const monthEntries = getMonthEntries();
  const totalHours = calculateTotalHours();

  if (loading && !appInfo) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
          <Text style={styles.loadingText}>Caricamento...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.dateSelectors}>
          <TouchableOpacity
            style={styles.monthButton}
            onPress={() => setShowMonthPicker(true)}
          >
            <Text style={styles.monthText}>
              {ITALIAN_MONTHS[selectedMonth - 1]}
            </Text>
            <Ionicons name="chevron-down" size={16} color="#666" />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.yearButton}
            onPress={() => setShowYearPicker(true)}
          >
            <Text style={styles.yearText}>
              {selectedYear}
            </Text>
            <Ionicons name="chevron-down" size={16} color="#666" />
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.employeeName}>{appInfo?.employee_name}</Text>
          <Text style={styles.matricola}>{appInfo?.matricola}</Text>
        </View>
      </View>

      <ScrollView style={styles.content}>
        {/* Entry Form Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Inserisci Ore</Text>
          
          {/* Day Selector */}
          <TouchableOpacity
            style={styles.inputRow}
            onPress={() => setShowDayPicker(true)}
          >
            <View style={styles.inputLabel}>
              <Ionicons name="calendar-outline" size={20} color="#666" />
              <Text style={styles.inputLabelText}>Giorno</Text>
            </View>
            <View style={styles.inputValue}>
              <Text style={[
                styles.inputValueText,
                isWeekend(selectedDay, selectedMonth, selectedYear) && styles.weekendText
              ]}>
                {selectedDay} - {getDayOfWeekName(selectedDay, selectedMonth, selectedYear)}
              </Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </View>
          </TouchableOpacity>

          {/* Commessa Selector */}
          <TouchableOpacity
            style={styles.inputRow}
            onPress={() => setShowCommessaPicker(true)}
          >
            <View style={styles.inputLabel}>
              <Ionicons name="briefcase-outline" size={20} color="#666" />
              <Text style={styles.inputLabelText}>Commessa</Text>
            </View>
            <View style={styles.inputValue}>
              <Text style={[
                styles.inputValueText,
                !selectedCommessa && styles.placeholderText
              ]}>
                {selectedCommessa || 'Seleziona commessa...'}
              </Text>
              <Ionicons name="chevron-forward" size={20} color="#999" />
            </View>
          </TouchableOpacity>

          {/* Hours Input */}
          <View style={styles.inputRow}>
            <View style={styles.inputLabel}>
              <Ionicons name="time-outline" size={20} color="#666" />
              <Text style={styles.inputLabelText}>Ore</Text>
            </View>
            <TextInput
              style={styles.hoursTextInput}
              value={hoursInput}
              onChangeText={setHoursInput}
              placeholder="0"
              placeholderTextColor="#999"
              keyboardType="decimal-pad"
              maxLength={5}
            />
          </View>

          {/* Add Button */}
          <TouchableOpacity
            style={[styles.addButton, saving && styles.addButtonDisabled]}
            onPress={addEntry}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="add-circle" size={24} color="#fff" />
                <Text style={styles.addButtonText}>Aggiungi</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Entries List Card */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Ore Inserite</Text>
            <View style={styles.totalBadge}>
              <Text style={styles.totalBadgeText}>Totale: {formatHours(totalHours)} ore</Text>
            </View>
          </View>

          {loading ? (
            <ActivityIndicator size="small" color="#2196F3" style={styles.listLoader} />
          ) : monthEntries.length === 0 ? (
            <View style={styles.emptyList}>
              <Ionicons name="document-text-outline" size={48} color="#ddd" />
              <Text style={styles.emptyListText}>Nessuna ora inserita per questo mese</Text>
            </View>
          ) : (
            <View style={styles.entriesList}>
              {monthEntries.map((entry, index) => (
                <TouchableOpacity
                  key={`${entry.day}-${entry.commessa}-${index}`}
                  style={styles.entryItem}
                  onLongPress={() => removeEntry(entry.commessa, entry.day)}
                >
                  <View style={[
                    styles.entryDay,
                    isWeekend(entry.day, selectedMonth, selectedYear) && styles.entryDayWeekend
                  ]}>
                    <Text style={[
                      styles.entryDayNumber,
                      isWeekend(entry.day, selectedMonth, selectedYear) && styles.entryDayWeekendText
                    ]}>
                      {entry.day}
                    </Text>
                    <Text style={[
                      styles.entryDayName,
                      isWeekend(entry.day, selectedMonth, selectedYear) && styles.entryDayWeekendText
                    ]}>
                      {ITALIAN_DAYS_SHORT[new Date(selectedYear, selectedMonth - 1, entry.day).getDay()]}
                    </Text>
                  </View>
                  <View style={styles.entryDetails}>
                    <Text style={styles.entryCommessa}>{entry.commessa}</Text>
                  </View>
                  <View style={styles.entryHours}>
                    <Text style={styles.entryHoursText}>{formatHours(entry.hours)}</Text>
                    <Text style={styles.entryHoursLabel}>ore</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
          
          <Text style={styles.hintText}>
            Tieni premuto su una voce per eliminarla
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Toolbar */}
      <View style={styles.bottomToolbar}>
        <TouchableOpacity style={styles.bottomButton} onPress={handlePreviewPDF} disabled={pdfLoading}>
          <Ionicons name="eye" size={22} color="#FF9800" />
          <Text style={styles.bottomButtonText}>Anteprima</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.bottomButton} onPress={handleDownloadPDF} disabled={pdfLoading}>
          <Ionicons name="download" size={22} color="#9C27B0" />
          <Text style={styles.bottomButtonText}>Stampa PDF</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.bottomButton} onPress={handleShareWhatsApp} disabled={pdfLoading}>
          <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
          <Text style={styles.bottomButtonText}>Invia PDF</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.bottomButton} onPress={openArchive}>
          <Ionicons name="archive" size={22} color="#607D8B" />
          <Text style={styles.bottomButtonText}>Archivio</Text>
        </TouchableOpacity>
      </View>

      {/* Month Picker Modal */}
      <Modal visible={showMonthPicker} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowMonthPicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleziona Mese</Text>
            <FlatList
              data={ITALIAN_MONTHS}
              keyExtractor={(_, index) => index.toString()}
              numColumns={3}
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  style={[
                    styles.monthItem,
                    selectedMonth === index + 1 && styles.monthItemSelected
                  ]}
                  onPress={() => {
                    setSelectedMonth(index + 1);
                    setShowMonthPicker(false);
                  }}
                >
                  <Text style={[
                    styles.monthItemText,
                    selectedMonth === index + 1 && styles.monthItemTextSelected
                  ]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Year Picker Modal */}
      <Modal visible={showYearPicker} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowYearPicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleziona Anno</Text>
            <FlatList
              data={availableYears}
              keyExtractor={(item) => item.toString()}
              numColumns={3}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.yearItem,
                    selectedYear === item && styles.yearItemSelected
                  ]}
                  onPress={() => {
                    setSelectedYear(item);
                    setShowYearPicker(false);
                  }}
                >
                  <Text style={[
                    styles.yearItemText,
                    selectedYear === item && styles.yearItemTextSelected
                  ]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Day Picker Modal */}
      <Modal visible={showDayPicker} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowDayPicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleziona Giorno</Text>
            <FlatList
              data={Array.from({ length: numDays }, (_, i) => i + 1)}
              keyExtractor={(item) => item.toString()}
              numColumns={7}
              renderItem={({ item }) => {
                const weekend = isWeekend(item, selectedMonth, selectedYear);
                return (
                  <TouchableOpacity
                    style={[
                      styles.dayItem,
                      selectedDay === item && styles.dayItemSelected,
                      weekend && styles.dayItemWeekend
                    ]}
                    onPress={() => {
                      setSelectedDay(item);
                      setShowDayPicker(false);
                    }}
                  >
                    <Text style={[
                      styles.dayItemText,
                      selectedDay === item && styles.dayItemTextSelected,
                      weekend && styles.dayItemTextWeekend
                    ]}>
                      {item}
                    </Text>
                    <Text style={[
                      styles.dayItemDayName,
                      selectedDay === item && styles.dayItemTextSelected,
                      weekend && styles.dayItemTextWeekend
                    ]}>
                      {ITALIAN_DAYS_SHORT[new Date(selectedYear, selectedMonth - 1, item).getDay()]}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Commessa Picker Modal */}
      <Modal visible={showCommessaPicker} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalBackdrop}
            activeOpacity={1}
            onPress={() => {
              setShowCommessaPicker(false);
              setNewCommessaInput('');
            }}
          />
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleziona Commessa</Text>
            
            <View style={styles.newCommessaContainer}>
              <TextInput
                style={styles.newCommessaInput}
                value={newCommessaInput}
                onChangeText={setNewCommessaInput}
                placeholder="Nuova commessa..."
                placeholderTextColor="#999"
                autoFocus={false}
              />
              <TouchableOpacity
                style={styles.addCommessaButton}
                onPress={addNewCommessa}
              >
                <Ionicons name="add" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            
            <ScrollView style={styles.commessaList}>
              {commesse.map((c) => (
                <View key={c.id} style={styles.commessaItemContainer}>
                  <TouchableOpacity
                    style={[
                      styles.commessaItem,
                      selectedCommessa === c.name && styles.commessaItemSelected
                    ]}
                    onPress={() => selectCommessa(c.name)}
                  >
                    <Text style={[
                      styles.commessaItemText,
                      selectedCommessa === c.name && styles.commessaItemTextSelected
                    ]}>
                      {c.name}
                    </Text>
                    {selectedCommessa === c.name && (
                      <Ionicons name="checkmark" size={20} color="#2196F3" />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteCommessaButton}
                    onPress={() => deleteCommessa(c)}
                  >
                    <Ionicons name="trash-outline" size={20} color="#e53935" />
                  </TouchableOpacity>
                </View>
              ))}
              {commesse.length === 0 && (
                <Text style={styles.noCommesseText}>
                  Nessuna commessa salvata. Inserisci una nuova commessa sopra.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Archive Modal */}
      <Modal visible={showArchive} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowArchive(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Archivio Timesheet {selectedYear}</Text>
            <ScrollView style={styles.archiveList}>
              {ITALIAN_MONTHS.map((month, index) => {
                const hasData = archivedTimesheets.some(t => t.month === index + 1);
                return (
                  <TouchableOpacity
                    key={index}
                    style={[
                      styles.archiveItem,
                      hasData && styles.archiveItemWithData,
                      selectedMonth === index + 1 && styles.archiveItemSelected
                    ]}
                    onPress={() => selectArchivedTimesheet(index + 1)}
                  >
                    <Ionicons
                      name={hasData ? 'document-text' : 'document-outline'}
                      size={20}
                      color={hasData ? '#4CAF50' : '#999'}
                    />
                    <Text style={[
                      styles.archiveItemText,
                      hasData && styles.archiveItemTextWithData
                    ]}>
                      {month}
                    </Text>
                    {hasData && (
                      <Ionicons name="checkmark-circle" size={16} color="#4CAF50" />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Loading overlay for PDF */}
      {pdfLoading && (
        <View style={styles.pdfLoadingOverlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.pdfLoadingText}>Generazione PDF...</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  monthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e3f2fd',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  monthText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1976D2',
    marginRight: 4,
  },
  yearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff3e0',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    marginLeft: 8,
  },
  yearText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E65100',
    marginRight: 4,
  },
  dateSelectors: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  employeeName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  matricola: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
  },
  totalBadge: {
    backgroundColor: '#e8f5e9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  totalBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4CAF50',
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  inputLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputLabelText: {
    fontSize: 15,
    color: '#666',
    marginLeft: 10,
  },
  inputValue: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputValueText: {
    fontSize: 15,
    color: '#333',
    fontWeight: '500',
    marginRight: 8,
  },
  placeholderText: {
    color: '#999',
    fontWeight: 'normal',
  },
  weekendText: {
    color: '#e53935',
  },
  hoursTextInput: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'right',
    minWidth: 80,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  addButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
  },
  addButtonDisabled: {
    backgroundColor: '#a5d6a7',
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
    marginLeft: 8,
  },
  listLoader: {
    padding: 40,
  },
  emptyList: {
    alignItems: 'center',
    padding: 40,
  },
  emptyListText: {
    fontSize: 14,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
  },
  entriesList: {
    marginTop: -8,
  },
  entryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  entryDay: {
    width: 50,
    height: 50,
    backgroundColor: '#e3f2fd',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  entryDayWeekend: {
    backgroundColor: '#ffebee',
  },
  entryDayNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1976D2',
  },
  entryDayWeekendText: {
    color: '#e53935',
  },
  entryDayName: {
    fontSize: 10,
    color: '#1976D2',
    marginTop: 2,
  },
  entryDetails: {
    flex: 1,
    marginLeft: 14,
  },
  entryCommessa: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  entryHours: {
    alignItems: 'flex-end',
  },
  entryHoursText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#4CAF50',
  },
  entryHoursLabel: {
    fontSize: 11,
    color: '#999',
  },
  hintText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginTop: 16,
    fontStyle: 'italic',
  },
  bottomToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
  },
  bottomButton: {
    alignItems: 'center',
    padding: 8,
    minWidth: 100,
  },
  bottomButtonText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 20,
    textAlign: 'center',
  },
  monthItem: {
    flex: 1,
    padding: 14,
    margin: 4,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  monthItemSelected: {
    backgroundColor: '#2196F3',
  },
  monthItemText: {
    fontSize: 13,
    color: '#333',
  },
  monthItemTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  yearItem: {
    flex: 1,
    padding: 14,
    margin: 4,
    borderRadius: 10,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  yearItemSelected: {
    backgroundColor: '#E65100',
  },
  yearItemText: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
  },
  yearItemTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  dayItem: {
    flex: 1,
    padding: 10,
    margin: 3,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    minWidth: 40,
  },
  dayItemSelected: {
    backgroundColor: '#2196F3',
  },
  dayItemWeekend: {
    backgroundColor: '#ffebee',
  },
  dayItemText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  dayItemTextSelected: {
    color: '#fff',
  },
  dayItemTextWeekend: {
    color: '#e53935',
  },
  dayItemDayName: {
    fontSize: 10,
    color: '#666',
    marginTop: 2,
  },
  newCommessaContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  newCommessaInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginRight: 10,
  },
  addCommessaButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 10,
    width: 48,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
  },
  commessaList: {
    maxHeight: 300,
  },
  commessaItemContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  commessaItem: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderRadius: 8,
  },
  commessaItemSelected: {
    backgroundColor: '#e3f2fd',
  },
  commessaItemText: {
    fontSize: 15,
    color: '#333',
  },
  commessaItemTextSelected: {
    color: '#1976D2',
    fontWeight: '500',
  },
  deleteCommessaButton: {
    padding: 12,
    marginRight: 4,
  },
  noCommesseText: {
    textAlign: 'center',
    color: '#999',
    fontStyle: 'italic',
    padding: 20,
  },
  archiveList: {
    maxHeight: 400,
  },
  archiveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    borderRadius: 8,
    marginBottom: 4,
  },
  archiveItemWithData: {
    backgroundColor: '#f0fff0',
  },
  archiveItemSelected: {
    backgroundColor: '#e3f2fd',
  },
  archiveItemText: {
    flex: 1,
    fontSize: 15,
    color: '#666',
    marginLeft: 12,
  },
  archiveItemTextWithData: {
    color: '#333',
    fontWeight: '500',
  },
  pdfLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pdfLoadingText: {
    color: '#fff',
    fontSize: 16,
    marginTop: 12,
  },
  hintTextModal: {
    fontSize: 11,
    color: '#999',
    textAlign: 'center',
    marginTop: 12,
    fontStyle: 'italic',
  },
});
