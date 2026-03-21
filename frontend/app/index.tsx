import React, { useState, useEffect, useCallback } from 'react';
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
  Dimensions,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

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

const ITALIAN_DAYS = ['Lu', 'Ma', 'Me', 'Gi', 'Ve', 'Sa', 'Do'];
const ITALIAN_MONTHS = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

const getDaysInMonth = (month: number, year: number): number => {
  return new Date(year, month, 0).getDate();
};

const getDayOfWeek = (day: number, month: number, year: number): number => {
  const date = new Date(year, month - 1, day);
  const dow = date.getDay();
  return dow === 0 ? 6 : dow - 1; // Convert Sunday=0 to Monday=0 format
};

const isWeekend = (day: number, month: number, year: number): boolean => {
  const dow = getDayOfWeek(day, month, year);
  return dow >= 5; // Saturday (5) or Sunday (6)
};

export default function TimesheetApp() {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [rows, setRows] = useState<TimesheetRow[]>([]);
  const [commesse, setCommesse] = useState<Commessa[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showCommessaPicker, setShowCommessaPicker] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [archivedTimesheets, setArchivedTimesheets] = useState<Timesheet[]>([]);
  const [currentEditingRow, setCurrentEditingRow] = useState<number | null>(null);
  const [newCommessaInput, setNewCommessaInput] = useState('');
  const [pdfLoading, setPdfLoading] = useState(false);

  const currentYear = appInfo?.current_year || 2025;
  const numDays = getDaysInMonth(selectedMonth, currentYear);

  // Fetch app info
  useEffect(() => {
    fetchAppInfo();
    fetchCommesse();
  }, []);

  // Fetch timesheet when month changes
  useEffect(() => {
    fetchTimesheet();
  }, [selectedMonth]);

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
      const response = await fetch(`${API_URL}/api/timesheets/${selectedMonth}`);
      if (response.ok) {
        const data = await response.json();
        if (data) {
          setTimesheet(data);
          setRows(data.rows || []);
        } else {
          setTimesheet(null);
          setRows([]);
        }
      } else {
        setTimesheet(null);
        setRows([]);
      }
    } catch (error) {
      console.error('Error fetching timesheet:', error);
      setTimesheet(null);
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

  const saveTimesheet = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/timesheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          month: selectedMonth,
          rows: rows.filter(r => r.commessa.trim() !== '')
        })
      });
      if (response.ok) {
        const data = await response.json();
        setTimesheet(data);
        await fetchCommesse(); // Refresh commesse list
        Alert.alert('Salvato', 'Timesheet salvato con successo!');
      }
    } catch (error) {
      console.error('Error saving timesheet:', error);
      Alert.alert('Errore', 'Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  };

  const addRow = () => {
    const newRow: TimesheetRow = {
      commessa: '',
      hours: Array(31).fill(0)
    };
    setRows([...rows, newRow]);
  };

  const updateCommessa = (index: number, commessa: string) => {
    const newRows = [...rows];
    newRows[index].commessa = commessa;
    setRows(newRows);
  };

  const updateHours = (rowIndex: number, dayIndex: number, value: string) => {
    const newRows = [...rows];
    // Convert comma to dot for parsing, then store as number
    const numValue = parseFloat(value.replace(',', '.')) || 0;
    newRows[rowIndex].hours[dayIndex] = numValue;
    setRows(newRows);
  };

  const removeRow = (index: number) => {
    Alert.alert(
      'Conferma',
      'Vuoi eliminare questa riga?',
      [
        { text: 'Annulla', style: 'cancel' },
        { text: 'Elimina', style: 'destructive', onPress: () => {
          const newRows = rows.filter((_, i) => i !== index);
          setRows(newRows);
        }}
      ]
    );
  };

  const calculateRowTotal = (row: TimesheetRow): number => {
    return row.hours.slice(0, numDays).reduce((sum, h) => sum + (h || 0), 0);
  };

  const calculateDayTotal = (dayIndex: number): number => {
    return rows.reduce((sum, row) => sum + (row.hours[dayIndex] || 0), 0);
  };

  const formatHours = (value: number): string => {
    if (value === 0) return '';
    return value.toString().replace('.', ',');
  };

  const handlePreviewPDF = async () => {
    setPdfLoading(true);
    try {
      // First save the current data
      await saveTimesheet();
      
      const response = await fetch(`${API_URL}/api/timesheets/${selectedMonth}/pdf`);
      const data = await response.json();
      
      if (data.pdf_base64) {
        const htmlContent = `
          <html>
            <body style="margin:0;padding:0;">
              <embed src="data:application/pdf;base64,${data.pdf_base64}" type="application/pdf" width="100%" height="100%">
            </body>
          </html>
        `;
        
        if (Platform.OS === 'web') {
          // Open PDF in new tab for web
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
          await Print.printAsync({
            uri: `data:application/pdf;base64,${data.pdf_base64}`
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
      // First save the current data
      await saveTimesheet();
      
      const response = await fetch(`${API_URL}/api/timesheets/${selectedMonth}/pdf`);
      const data = await response.json();
      
      if (data.pdf_base64) {
        if (Platform.OS === 'web') {
          // Download for web
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
          // Share for mobile
          const fileUri = `${Print.printToFileAsync ? '' : 'file://'}${data.filename}`;
          if (await Sharing.isAvailableAsync()) {
            // Create a temporary file and share
            const result = await Print.printToFileAsync({
              html: `<html><body><p>PDF</p></body></html>`,
              base64: false
            });
            await Sharing.shareAsync(result.uri);
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

  const selectCommessaForRow = (commessa: string) => {
    if (currentEditingRow !== null) {
      updateCommessa(currentEditingRow, commessa);
      setShowCommessaPicker(false);
      setCurrentEditingRow(null);
      setNewCommessaInput('');
    }
  };

  const addNewCommessa = () => {
    if (newCommessaInput.trim()) {
      selectCommessaForRow(newCommessaInput.trim());
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
        <View style={styles.headerLeft}>
          <TouchableOpacity
            style={styles.monthButton}
            onPress={() => setShowMonthPicker(true)}
          >
            <Text style={styles.monthText}>
              {ITALIAN_MONTHS[selectedMonth - 1]} {currentYear}
            </Text>
            <Ionicons name="chevron-down" size={20} color="#333" />
          </TouchableOpacity>
        </View>
        <View style={styles.headerRight}>
          <Text style={styles.employeeName}>{appInfo?.employee_name}</Text>
          <Text style={styles.matricola}>{appInfo?.matricola}</Text>
        </View>
      </View>

      {/* Toolbar */}
      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolButton} onPress={addRow}>
          <Ionicons name="add-circle" size={24} color="#4CAF50" />
          <Text style={styles.toolButtonText}>Aggiungi Riga</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.toolButton} onPress={saveTimesheet} disabled={saving}>
          <Ionicons name="save" size={24} color="#2196F3" />
          <Text style={styles.toolButtonText}>{saving ? 'Salvataggio...' : 'Salva'}</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.toolButton} onPress={handlePreviewPDF} disabled={pdfLoading}>
          <Ionicons name="eye" size={24} color="#FF9800" />
          <Text style={styles.toolButtonText}>Anteprima</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.toolButton} onPress={handleDownloadPDF} disabled={pdfLoading}>
          <Ionicons name="download" size={24} color="#9C27B0" />
          <Text style={styles.toolButtonText}>Stampa PDF</Text>
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.toolButton} onPress={openArchive}>
          <Ionicons name="archive" size={24} color="#607D8B" />
          <Text style={styles.toolButtonText}>Archivio</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#2196F3" />
        </View>
      ) : (
        <ScrollView style={styles.tableContainer} horizontal>
          <View>
            {/* Table Header - Day Names */}
            <View style={styles.tableRow}>
              <View style={[styles.cellCommessa, styles.headerCell]}>
                <Text style={styles.headerText}>COMMESSA</Text>
              </View>
              {Array.from({ length: numDays }, (_, i) => {
                const day = i + 1;
                const dow = getDayOfWeek(day, selectedMonth, currentYear);
                const weekend = isWeekend(day, selectedMonth, currentYear);
                return (
                  <View key={`dayname-${i}`} style={[styles.cellDay, styles.headerCell]}>
                    <Text style={[styles.dayNameText, weekend && styles.weekendText]}>
                      {ITALIAN_DAYS[dow]}
                    </Text>
                  </View>
                );
              })}
              <View style={[styles.cellTotal, styles.headerCell]}>
                <Text style={styles.headerText}>Tot. Ore</Text>
              </View>
            </View>

            {/* Table Header - Day Numbers */}
            <View style={styles.tableRow}>
              <View style={[styles.cellCommessa, styles.headerCell]} />
              {Array.from({ length: numDays }, (_, i) => {
                const day = i + 1;
                const weekend = isWeekend(day, selectedMonth, currentYear);
                return (
                  <View key={`daynum-${i}`} style={[styles.cellDay, styles.headerCell]}>
                    <Text style={[styles.dayNumberText, weekend && styles.weekendText]}>
                      {day.toString().padStart(2, '0')}
                    </Text>
                  </View>
                );
              })}
              <View style={[styles.cellTotal, styles.headerCell]} />
            </View>

            {/* Data Rows */}
            {rows.map((row, rowIndex) => (
              <View key={`row-${rowIndex}`} style={styles.tableRow}>
                <TouchableOpacity
                  style={[styles.cellCommessa, styles.dataCell]}
                  onPress={() => {
                    setCurrentEditingRow(rowIndex);
                    setShowCommessaPicker(true);
                  }}
                  onLongPress={() => removeRow(rowIndex)}
                >
                  <Text style={styles.commessaText} numberOfLines={1}>
                    {row.commessa || 'Seleziona...'}
                  </Text>
                </TouchableOpacity>
                {Array.from({ length: numDays }, (_, dayIndex) => {
                  const weekend = isWeekend(dayIndex + 1, selectedMonth, currentYear);
                  return (
                    <View
                      key={`cell-${rowIndex}-${dayIndex}`}
                      style={[styles.cellDay, styles.dataCell, weekend && styles.weekendCell]}
                    >
                      <TextInput
                        style={styles.hoursInput}
                        value={formatHours(row.hours[dayIndex] || 0)}
                        onChangeText={(value) => updateHours(rowIndex, dayIndex, value)}
                        keyboardType="decimal-pad"
                        placeholder=""
                        maxLength={4}
                      />
                    </View>
                  );
                })}
                <View style={[styles.cellTotal, styles.dataCell]}>
                  <Text style={styles.totalText}>
                    {formatHours(calculateRowTotal(row)) || '0'}
                  </Text>
                </View>
              </View>
            ))}

            {/* Empty rows placeholder */}
            {rows.length === 0 && (
              <View style={styles.emptyRow}>
                <Text style={styles.emptyText}>
                  Premi "Aggiungi Riga" per iniziare
                </Text>
              </View>
            )}

            {/* Totals Row */}
            <View style={[styles.tableRow, styles.totalsRow]}>
              <View style={[styles.cellCommessa, styles.totalCell]}>
                <Text style={styles.totalLabelText}>TOTALE</Text>
              </View>
              {Array.from({ length: numDays }, (_, dayIndex) => (
                <View key={`total-${dayIndex}`} style={[styles.cellDay, styles.totalCell]}>
                  <Text style={styles.dayTotalText}>
                    {formatHours(calculateDayTotal(dayIndex)) || '0'}
                  </Text>
                </View>
              ))}
              <View style={[styles.cellTotal, styles.totalCell]}>
                <Text style={styles.grandTotalText}>
                  {formatHours(rows.reduce((sum, row) => sum + calculateRowTotal(row), 0)) || '0'}
                </Text>
              </View>
            </View>
          </View>
        </ScrollView>
      )}

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

      {/* Commessa Picker Modal */}
      <Modal visible={showCommessaPicker} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => {
            setShowCommessaPicker(false);
            setCurrentEditingRow(null);
            setNewCommessaInput('');
          }}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Seleziona Commessa</Text>
            
            {/* New commessa input */}
            <View style={styles.newCommessaContainer}>
              <TextInput
                style={styles.newCommessaInput}
                value={newCommessaInput}
                onChangeText={setNewCommessaInput}
                placeholder="Nuova commessa..."
                placeholderTextColor="#999"
              />
              <TouchableOpacity
                style={styles.addCommessaButton}
                onPress={addNewCommessa}
              >
                <Ionicons name="add" size={24} color="#fff" />
              </TouchableOpacity>
            </View>
            
            {/* Existing commesse */}
            <ScrollView style={styles.commessaList}>
              {commesse.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.commessaItem}
                  onPress={() => selectCommessaForRow(c.name)}
                >
                  <Text style={styles.commessaItemText}>{c.name}</Text>
                </TouchableOpacity>
              ))}
              {commesse.length === 0 && (
                <Text style={styles.noCommesseText}>
                  Nessuna commessa salvata. Inserisci una nuova commessa sopra.
                </Text>
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Archive Modal */}
      <Modal visible={showArchive} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowArchive(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Archivio Timesheet {currentYear}</Text>
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
    backgroundColor: '#f5f5f5',
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
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    alignItems: 'flex-end',
  },
  monthButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  monthText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginRight: 8,
  },
  employeeName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
  },
  matricola: {
    fontSize: 14,
    color: '#666',
  },
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  toolButton: {
    alignItems: 'center',
    padding: 8,
  },
  toolButtonText: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  tableContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  tableRow: {
    flexDirection: 'row',
  },
  cellCommessa: {
    width: 120,
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: 0.5,
    borderColor: '#ddd',
  },
  cellDay: {
    width: 40,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#ddd',
  },
  cellTotal: {
    width: 60,
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0.5,
    borderColor: '#ddd',
    backgroundColor: '#f9f9f9',
  },
  headerCell: {
    backgroundColor: '#e8e8e8',
  },
  dataCell: {
    backgroundColor: '#fff',
  },
  weekendCell: {
    backgroundColor: '#fff5f5',
  },
  totalCell: {
    backgroundColor: '#e0e0e0',
  },
  headerText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
  },
  dayNameText: {
    fontSize: 10,
    color: '#333',
  },
  dayNumberText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#333',
  },
  weekendText: {
    color: '#e53935',
  },
  commessaText: {
    fontSize: 11,
    color: '#333',
  },
  hoursInput: {
    width: '100%',
    height: '100%',
    textAlign: 'center',
    fontSize: 11,
    color: '#333',
  },
  totalText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#333',
  },
  totalLabelText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#333',
  },
  dayTotalText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#333',
  },
  grandTotalText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#1976D2',
  },
  totalsRow: {
    borderTopWidth: 2,
    borderTopColor: '#333',
  },
  emptyRow: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    width: '90%',
    maxWidth: 400,
    maxHeight: '80%',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 16,
    textAlign: 'center',
  },
  monthItem: {
    flex: 1,
    padding: 12,
    margin: 4,
    borderRadius: 8,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
  },
  monthItemSelected: {
    backgroundColor: '#2196F3',
  },
  monthItemText: {
    fontSize: 12,
    color: '#333',
  },
  monthItemTextSelected: {
    color: '#fff',
    fontWeight: 'bold',
  },
  newCommessaContainer: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  newCommessaInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginRight: 8,
  },
  addCommessaButton: {
    backgroundColor: '#4CAF50',
    borderRadius: 8,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  commessaList: {
    maxHeight: 300,
  },
  commessaItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  commessaItemText: {
    fontSize: 14,
    color: '#333',
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
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  archiveItemWithData: {
    backgroundColor: '#f0fff0',
  },
  archiveItemSelected: {
    backgroundColor: '#e3f2fd',
  },
  archiveItemText: {
    flex: 1,
    fontSize: 14,
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
});
