$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("$([Environment]::GetFolderPath('Desktop'))\OSCAR Dashboard.lnk")
$Shortcut.TargetPath = "c:\Projects\OSCAR\launch_oscar.bat"
$Shortcut.WorkingDirectory = "c:\Projects\OSCAR"
$Shortcut.IconLocation = "c:\Projects\OSCAR\public\icon.png"
$Shortcut.Save()
