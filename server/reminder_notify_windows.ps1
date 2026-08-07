param(
  [string]$Title = "Adeo Reminder",
  [string]$Body = "",
  [string]$Url = ""
)

[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null

# Must match app.setAppUserModelId('com.adeo.app') in src/main.ts so the toast
# shows Adeo's identity/icon instead of a generic PowerShell one.
$AppId = "com.adeo.app"

$escapedTitle = [System.Security.SecurityElement]::Escape($Title)
$escapedBody = [System.Security.SecurityElement]::Escape($Body)
$escapedUrl = [System.Security.SecurityElement]::Escape($Url)

$template = @"
<toast activationType="protocol" launch="$escapedUrl">
  <visual>
    <binding template="ToastGeneric">
      <text>$escapedTitle</text>
      <text>$escapedBody</text>
    </binding>
  </visual>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($template)
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($AppId).Show($toast)
