function Select-NgiiUiAction {
    param($Snapshot, [string[]]$Requested, [hashtable]$Attempted)
    if (!$Snapshot.TrustedProcess -or $Requested.Count -eq 0) { return $null }
    $requestKey = ($Requested | Sort-Object) -join ','
    if ($Snapshot.Kind -eq 'application' -and $Snapshot.DownloadButtonCount -eq 1 -and $Snapshot.HasFormFooter) {
        $key = 'application:' + $requestKey
        if (!$Attempted.ContainsKey($key)) { return @{ Key = $key; Action = 'application' } }
    }
    if ($Snapshot.Kind -eq 'transfer' -and !$Snapshot.Transferring -and $Snapshot.FileNumbers.Count -gt 0) {
        # The displayed file list must contain every outstanding sheet in this batch.
        foreach ($number in $Requested) { if ($Snapshot.FileNumbers -notcontains $number) { return $null } }
        $fileKey = ($Snapshot.FileNumbers | Sort-Object -Unique) -join ','
        if ($Snapshot.StartButtonCount -eq 1) {
            $key = 'start:' + $fileKey
            if (!$Attempted.ContainsKey($key)) { return @{ Key = $key; Action = 'start' } }
        } elseif ($Snapshot.AllButtonCount -eq 1) {
            $key = 'all:' + $fileKey
            if (!$Attempted.ContainsKey($key)) { return @{ Key = $key; Action = 'all' } }
        }
    }
    return $null
}
