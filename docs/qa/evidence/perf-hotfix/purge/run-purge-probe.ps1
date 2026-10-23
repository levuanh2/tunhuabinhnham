$ErrorActionPreference = "Stop"
$scriptPath = Join-Path $PSScriptRoot "purge-probe.mjs"
$securePassword = $null
$bstr = [IntPtr]::Zero
$plainPassword = $null

try {
    $email = Read-Host "Admin email (kept only in this process)"
    $securePassword = Read-Host "Admin password (hidden; never logged or written)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)

    $env:E2E_ADMIN_EMAIL = $email
    $env:E2E_ADMIN_PASSWORD = $plainPassword
    & node $scriptPath
    exit $LASTEXITCODE
}
finally {
    Remove-Item Env:E2E_ADMIN_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:E2E_ADMIN_PASSWORD -ErrorAction SilentlyContinue
    $plainPassword = $null
    $securePassword = $null
    if ($bstr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}
