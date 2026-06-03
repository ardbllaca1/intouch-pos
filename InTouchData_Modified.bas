Option Compare Database
Option Explicit

' ================================================================
'  InTouchData - POS Live Dashboard Sender
'  Sends daily sales data to intouch-data.com every 30 seconds
' ================================================================

' --- CONFIG - change these per client installation ---
Private Const CLIENT_URL As String = "https://demo.intouch-data.com/api/sales"
Private Const API_KEY    As String = "2YxfFxPm4MpPDQGDA1WURDOjFzNEZ7sl"
' -----------------------------------------------------

Private mTimer As Double

' ================================================================
'  ENTRY POINT - Call this from your AutoExec macro or startup form
' ================================================================
Public Sub StartLiveSender()
    Call SendSalesData
    ' Open the hidden timer form
    DoCmd.OpenForm "frmTimer", , , , , acHidden
End Sub

Public Sub StopLiveSender()
    On Error Resume Next
    DoCmd.Close acForm, "frmTimer"
End Sub

' ================================================================
'  MAIN SENDER
' ================================================================
Public Sub SendSalesData()
    On Error GoTo ErrHandler

    Dim json As String
    json = BuildJSON()

    If json = "" Then Exit Sub

    Dim http As Object
    Set http = CreateObject("WinHttp.WinHttpRequest.5.1")

    http.Open "POST", CLIENT_URL, False
    http.setRequestHeader "Content-Type", "application/json"
    http.setRequestHeader "x-api-key", API_KEY
    http.SetTimeouts 5000, 5000, 10000, 10000
    http.Send json

    If http.Status = 200 Then
        ' Success - optionally log it
        ' Debug.Print "[" & Now & "] Sent OK"
    Else
        Debug.Print "[" & Now & "] HTTP Error: " & http.Status
    End If

    Set http = Nothing
    Exit Sub

ErrHandler:
    Debug.Print "[" & Now & "] Send error: " & Err.Description
End Sub

' ================================================================
'  BUILD FULL JSON PAYLOAD
' ================================================================
Private Function BuildJSON() As String
    On Error GoTo ErrHandler

    Dim today As String
    today = Format(Date, "YYYY-MM-DD")

    Dim json As String
    json = "{"

    json = json & """date"":""" & today & ""","
    json = json & """totalSales"":" & JsonNumber(GetTotalSales(today)) & ","
    json = json & """byWaiter"":" & GetByWaiter(today) & ","
    json = json & """byDepartment"":" & GetByDepartment(today) & ","
    json = json & """hourly"":" & GetHourly(today) & ","
    json = json & """tables"":" & GetTables(today) & ","
    json = json & """allOrders"":" & GetAllOrders(today) & ","
    json = json & """products"":" & GetProducts(today)

    json = json & "}"

    BuildJSON = json
    Exit Function

ErrHandler:
    Debug.Print "BuildJSON error: " & Err.Description
    BuildJSON = ""
End Function

' ================================================================
'  TOTAL SALES FOR TODAY
' ================================================================
Private Function GetTotalSales(today As String) As Double
    On Error GoTo ErrHandler

    Dim sql As String
    sql = "SELECT Sum([sasia]*[qmimishites]) AS totali " & _
          "FROM [tbldetalet e faturimit]"

    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset(sql, dbOpenSnapshot)

    If Not rs.EOF Then
        If Not IsNull(rs!totali) Then
            GetTotalSales = CDbl(rs!totali)
        End If
    End If

    rs.Close
    Set rs = Nothing
    Exit Function

ErrHandler:
    Debug.Print "GetTotalSales error: " & Err.Description
    GetTotalSales = 0
End Function

' ================================================================
'  SALES BY WAITER
' ================================================================
Private Function GetByWaiter(today As String) As String
    On Error GoTo ErrHandler

    Dim sql As String
    sql = "SELECT u.UserPassword AS emri, " & _
          "       Sum(f.[sasia]*f.[qmimishites]) AS totali " & _
          "FROM [tbldetalet e faturimit] AS f " & _
          "INNER JOIN tblUser AS u ON CStr(f.kam) = CStr(u.UserName) " & _
          "GROUP BY u.UserPassword " & _
          "ORDER BY Sum(f.[sasia]*f.[qmimishites]) DESC"

    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset(sql, dbOpenSnapshot)

    Dim arr As String
    arr = "["
    Dim first As Boolean
    first = True

    Do While Not rs.EOF
        If Not first Then arr = arr & ","
        arr = arr & "{""name"":""" & EscapeJSON(Nz(rs!Emri, "")) & """," & _
                    """total"":" & JsonNumber(rs!totali) & "}"
        first = False
        rs.MoveNext
    Loop

    arr = arr & "]"
    rs.Close
    Set rs = Nothing

    GetByWaiter = arr
    Exit Function

ErrHandler:
    Debug.Print "GetByWaiter error: " & Err.Description
    GetByWaiter = "[]"
End Function

' ================================================================
'  SALES BY DEPARTMENT (Banaku=B, Kuzhina=K from tblprodukti.nj2)
' ================================================================
Private Function GetByDepartment(today As String) As String
    On Error GoTo ErrHandler

    Dim sql As String
    sql = "SELECT IIf(p.nj2='B','Banaku','Kuzhina') AS departamenti, " & _
          "       Sum(f.[sasia]*f.[qmimishites]) AS totali " & _
          "FROM [tbldetalet e faturimit] AS f " & _
          "INNER JOIN tblprodukti AS p ON f.fKeyProductID = p.pkeyProductID " & _
          "WHERE p.nj2 IN ('B','K') " & _
          "GROUP BY IIf(p.nj2='B','Banaku','Kuzhina') " & _
          "ORDER BY Sum(f.[sasia]*f.[qmimishites]) DESC"

    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset(sql, dbOpenSnapshot)

    Dim arr As String
    arr = "["
    Dim first As Boolean
    first = True

    Do While Not rs.EOF
        If Not first Then arr = arr & ","
        arr = arr & "{""name"":""" & EscapeJSON(Nz(rs!departamenti, "")) & """," & _
                    """total"":" & JsonNumber(rs!totali) & "}"
        first = False
        rs.MoveNext
    Loop

    arr = arr & "]"
    rs.Close
    Set rs = Nothing

    GetByDepartment = arr
    Exit Function

ErrHandler:
    Debug.Print "GetByDepartment error: " & Err.Description
    GetByDepartment = "[]"
End Function

' ================================================================
'  HOURLY BREAKDOWN (orders count per hour slot)
' ================================================================
Private Function GetHourly(today As String) As String
    On Error GoTo ErrHandler

    Dim sql As String
    sql = "SELECT CStr(Hour([ora])) & '-' & CStr(Hour([ora])+1) AS ora_slot, " & _
          "       Count(*) AS numri " & _
          "FROM [tbldetalet e faturimit] " & _
          "WHERE [ora] IS NOT NULL " & _
          "GROUP BY Hour([ora]) " & _
          "ORDER BY Hour([ora]) ASC"

    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset(sql, dbOpenSnapshot)

    Dim arr As String
    arr = "["
    Dim first As Boolean
    first = True

    Do While Not rs.EOF
        If Not first Then arr = arr & ","

        Dim slotLabel As String
        slotLabel = CStr(Nz(rs!ora_slot, ""))

        Dim parts() As String
        parts = Split(slotLabel, "-")
        If UBound(parts) >= 1 Then
            If Len(parts(1)) = 1 Then slotLabel = parts(0) & "-0" & parts(1)
        End If

        arr = arr & "{""hour"":""" & EscapeJSON(slotLabel) & """," & _
                    """count"":" & Nz(rs!numri, 0) & "}"
        first = False
        rs.MoveNext
    Loop

    arr = arr & "]"
    rs.Close
    Set rs = Nothing

    GetHourly = arr
    Exit Function

ErrHandler:
    Debug.Print "GetHourly error: " & Err.Description
    GetHourly = "[]"
End Function

' ================================================================
'  TABLES STATUS
'  Adresa = table number/name always
'  Blersi = table number/name only while active, otherwise x
' ================================================================
Private Function GetTables(today As String) As String
    On Error GoTo ErrHandler

    Dim sql As String
    sql = "SELECT CStr([Adresa]) AS tavolina, " & _
          "       Sum(IIf(LCase(Trim(Nz([Blersi],'x'))) <> 'x', 1, 0)) AS open_count " & _
          "FROM [tbldetalet e faturimit] " & _
          "WHERE [Adresa] IS NOT NULL " & _
          "GROUP BY CStr([Adresa]) " & _
          "ORDER BY CStr([Adresa]) ASC"

    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset(sql, dbOpenSnapshot)

    Dim arr As String
    arr = "["
    Dim first As Boolean
    first = True

    Do While Not rs.EOF
        If Not first Then arr = arr & ","

        arr = arr & "{""name"":""" & EscapeJSON(Nz(rs!Tavolina, "")) & """," & _
                    """active"":" & IIf(Nz(rs!open_count, 0) > 0, "true", "false") & "}"

        first = False
        rs.MoveNext
    Loop

    arr = arr & "]"

    rs.Close
    Set rs = Nothing

    GetTables = arr
    Exit Function

ErrHandler:
    Debug.Print "GetTables error: " & Err.Description
    GetTables = "[]"
End Function

' ================================================================
'  ALL ORDERS FOR TODAY
'  tav uses Adresa always.
'  isActive is true only when Blersi is not x.
' ================================================================
Private Function GetAllOrders(today As String) As String
    On Error GoTo ErrHandler

    Dim sql As String
    sql = "SELECT p.strartikulli AS produkti, " & _
          "       f.sasia, " & _
          "       f.[qmimishites], " & _
          "       CStr(f.Adresa) AS tavolina, " & _
          "       Format(f.ora,'HH:MM') AS ora_fmt, " & _
          "       IIf(IsNull(u.UserPassword), CStr(f.kam), u.UserPassword) AS kamarier, " & _
          "       IIf(LCase(Trim(Nz(f.[Blersi],'x'))) <> 'x', 1, 0) AS active_marker " & _
          "FROM ([tbldetalet e faturimit] AS f " & _
          "LEFT JOIN tblprodukti AS p ON f.fKeyProductID = p.pkeyProductID) " & _
          "LEFT JOIN tblUser AS u ON f.kam = u.UserName " & _
          "ORDER BY f.ora DESC"

    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset(sql, dbOpenSnapshot)

    Dim arr As String
    arr = "["
    Dim first As Boolean
    first = True

    Do While Not rs.EOF
        Dim vlera As Double
        vlera = CDbl(Nz(rs!sasia, 0)) * CDbl(Nz(rs!qmimishites, 0))

        If Not first Then arr = arr & ","
        arr = arr & "{" & _
              """produkti"":""" & EscapeJSON(Nz(rs!produkti, "")) & """," & _
              """sasia"":" & JsonNumber(rs!sasia) & "," & _
              """vlera"":" & JsonNumber(vlera) & "," & _
              """tav"":""" & EscapeJSON(Nz(rs!Tavolina, "")) & """," & _
              """time"":""" & EscapeJSON(Nz(rs!ora_fmt, "")) & """," & _
              """kam"":""" & EscapeJSON(Nz(rs!kamarier, "")) & """," & _
              """isActive"":" & IIf(Nz(rs!active_marker, 0) > 0, "true", "false") & _
              "}"
        first = False
        rs.MoveNext
    Loop

    arr = arr & "]"
    rs.Close
    Set rs = Nothing

    GetAllOrders = arr
    Exit Function

ErrHandler:
    Debug.Print "GetAllOrders error: " & Err.Description
    GetAllOrders = "[]"
End Function

' ================================================================
'  PRODUCTS SOLD TODAY (grouped, sorted by quantity)
' ================================================================
Private Function GetProducts(today As String) As String
    On Error GoTo ErrHandler

    Dim sql As String
    sql = "SELECT p.strartikulli AS produkti, " & _
          "       Sum(f.sasia) AS sasia_total, " & _
          "       Avg(f.[qmimishites]) AS qmimi, " & _
          "       Sum(f.[sasia]*f.[qmimishites]) AS vlera_total " & _
          "FROM [tbldetalet e faturimit] AS f " & _
          "LEFT JOIN tblprodukti AS p ON f.fKeyProductID = p.pkeyProductID " & _
          "GROUP BY p.strartikulli " & _
          "ORDER BY Sum(f.sasia) DESC"

    Dim rs As DAO.Recordset
    Set rs = CurrentDb.OpenRecordset(sql, dbOpenSnapshot)

    Dim arr As String
    arr = "["
    Dim first As Boolean
    first = True

    Do While Not rs.EOF
        If Not first Then arr = arr & ","
        arr = arr & "{" & _
              """produkti"":""" & EscapeJSON(Nz(rs!produkti, "")) & """," & _
              """sasia"":" & JsonNumber(rs!sasia_total) & "," & _
              """qmimi"":" & JsonNumber(rs!qmimi) & "," & _
              """vlera"":" & JsonNumber(rs!vlera_total) & _
              "}"
        first = False
        rs.MoveNext
    Loop

    arr = arr & "]"
    rs.Close
    Set rs = Nothing

    GetProducts = arr
    Exit Function

ErrHandler:
    Debug.Print "GetProducts error: " & Err.Description
    GetProducts = "[]"
End Function

Private Function JsonNumber(v As Variant) As String
    JsonNumber = Replace(Format(Nz(v, 0), "0.00"), ",", ".")
End Function

' ================================================================
'  HELPER: Escape special characters for JSON strings
' ================================================================
Private Function EscapeJSON(s As String) As String
    s = Replace(s, "\", "\\")
    s = Replace(s, """", "\""")
    s = Replace(s, "/", "\/")
    s = Replace(s, Chr(8), "\b")
    s = Replace(s, Chr(9), "\t")
    s = Replace(s, Chr(10), "\n")
    s = Replace(s, Chr(13), "\r")
    EscapeJSON = s
End Function
