$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ngii-ui-policy.ps1')
function Assert-Policy($Condition, $Message) { if (!$Condition) { throw $Message } }
$requested=@('376082376','376082377')
$attempted=@{}
$application=@{ TrustedProcess=$true; Kind='application'; DownloadButtonCount=1; HasFormFooter=$true }
$result=Select-NgiiUiAction $application $requested $attempted
Assert-Policy ($result.Action -eq 'application') 'Expected ready application action'
$attempted[$result.Key]=$true
Assert-Policy ($null -eq (Select-NgiiUiAction $application $requested $attempted)) 'Duplicate application must not run'
$application.TrustedProcess=$false
Assert-Policy ($null -eq (Select-NgiiUiAction $application $requested @{})) 'Other Chrome windows must not be controlled'
$transfer=@{ TrustedProcess=$true; Kind='transfer'; FileNumbers=$requested; Transferring=$false; AllButtonCount=1; StartButtonCount=0 }
Assert-Policy ((Select-NgiiUiAction $transfer $requested @{}).Action -eq 'all') 'Expected matching transfer'
$transfer.Transferring=$true
Assert-Policy ($null -eq (Select-NgiiUiAction $transfer $requested @{})) 'Active transfer must not be restarted'
$transfer.Transferring=$false
$transfer.FileNumbers=@('376080900')
Assert-Policy ($null -eq (Select-NgiiUiAction $transfer $requested @{})) 'Old batch must not be downloaded again'
$transfer.FileNumbers=$requested; $transfer.AllButtonCount=2
Assert-Policy ($null -eq (Select-NgiiUiAction $transfer $requested @{})) 'Ambiguous buttons must not be clicked'
Assert-Policy ($null -eq (Select-NgiiUiAction $transfer @() @{})) 'No request means no action'
Write-Output 'NGII UI policy passed: scoped process, current batch, single action, active transfer and duplicate guards.'
