Function QuoteArg(value)
  QuoteArg = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = QuoteArg(baseDir & "\runtime\node.exe") & " " & QuoteArg(baseDir & "\faolla-print-helper.mjs")
For index = 0 To WScript.Arguments.Count - 1
  cmd = cmd & " " & QuoteArg(WScript.Arguments(index))
Next
shell.Run cmd, 0, False
