# Waits until the window of a process shows a piece of text, read from outside
# the process through UI Automation, as a screen reader reads it. Nothing is
# clicked or typed. Prints what it found and exits 0, or exits 1 at the deadline.
#
#   powershell -File window-text.ps1 -ProcessId <pid> -Text <text> [-Seconds 30]
param(
  [Parameter(Mandatory)][int]$ProcessId,
  [Parameter(Mandatory)][string]$Text,
  [int]$Seconds = 30
)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$automation = [System.Windows.Automation.AutomationElement]
$scope = [System.Windows.Automation.TreeScope]
$ofProcess = New-Object System.Windows.Automation.PropertyCondition(
  $automation::ProcessIdProperty, $ProcessId)
$any = [System.Windows.Automation.Condition]::TrueCondition
$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  $window = $automation::RootElement.FindFirst($scope::Children, $ofProcess)
  if ($window) {
    # A list item's name can carry more than the text it shows first.
    foreach ($element in $window.FindAll($scope::Descendants, $any)) {
      if ($element.Current.Name -like "*$Text*") {
        "shown: $($element.Current.ControlType.ProgrammaticName) '$($element.Current.Name)'"
        exit 0
      }
    }
  }
  Start-Sleep -Milliseconds 500
}
"not shown within $Seconds s: '$Text'"
exit 1
