# TradeSync MT5 - Graphical Windows Installer & Setup Wizard
# Runs cleanly on Windows 10/11 with built-in PowerShell WinForms (zero external deps)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppRoot = Resolve-Path (Join-Path $ScriptDir "..")
Set-Location $AppRoot

function Get-HostDiagnostics {
    $os = [System.Environment]::OSVersion.VersionString
    $cs = Get-CimInstance Win32_ComputerSystem -ErrorAction SilentlyContinue
    $totalRamGb = if ($cs) { [Math]::Round($cs.TotalPhysicalMemory / 1GB, 1) } else { 8 }
    $cores = [System.Environment]::ProcessorCount
    $drive = Get-PSDrive -Name ($AppRoot.Path.Substring(0,1)) -ErrorAction SilentlyContinue
    $freeGb = if ($drive) { [Math]::Round($drive.Free / 1GB, 1) } else { 20 }
    $safeFollowers = [Math]::Max(1, [Math]::Floor((($totalRamGb * 1024) - [Math]::Max(2048, $totalRamGb * 256)) / 165))

    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    $nodeVer = if ($nodeCmd) { (& node -v 2>$null) } else { $null }

    $mt5Candidates = @(
        "C:\Program Files\MetaTrader 5",
        "C:\Program Files\MetaTrader 5 EXNESS",
        "C:\Program Files\Exness MetaTrader 5",
        "C:\Program Files (x86)\MetaTrader 5",
        "C:\MT5_Master"
    )
    $foundMt5 = $mt5Candidates | Where-Object { Test-Path (Join-Path $_ "terminal64.exe") } | Select-Object -First 1

    return @{
        OS = $os
        RamGb = $totalRamGb
        Cores = $cores
        FreeGb = $freeGb
        SafeFollowers = $safeFollowers
        NodeVersion = $nodeVer
        Mt5Path = $foundMt5
    }
}

$diag = Get-HostDiagnostics

$form = New-Object System.Windows.Forms.Form
$form.Text = "TradeSync MT5 - Windows Setup Wizard"
$form.Size = New-Object System.Drawing.Size(700, 590)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(15, 23, 42)
$form.ForeColor = [System.Drawing.Color]::FromArgb(241, 245, 249)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "TradeSync MT5 Local Copy-Trading Platform"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$lblTitle.Location = New-Object System.Drawing.Point(20, 16)
$lblTitle.Size = New-Object System.Drawing.Size(640, 28)
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "100% Free Local Windows Software | Exact 1:1 Standard & Cent Copying | Multi-MT5 Automation"
$lblSub.ForeColor = [System.Drawing.Color]::FromArgb(148, 163, 184)
$lblSub.Location = New-Object System.Drawing.Point(20, 46)
$lblSub.Size = New-Object System.Drawing.Size(640, 20)
$form.Controls.Add($lblSub)

# System Check Panel
$grpCheck = New-Object System.Windows.Forms.GroupBox
$grpCheck.Text = "1. System & Environment Check"
$grpCheck.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$grpCheck.Location = New-Object System.Drawing.Point(20, 76)
$grpCheck.Size = New-Object System.Drawing.Size(644, 130)
$form.Controls.Add($grpCheck)

$nodeStatusText = if ($diag.NodeVersion) { "Node.js $($diag.NodeVersion) (Ready)" } else { "NOT FOUND - Install Node.js 22 LTS" }
$mt5StatusText = if ($diag.Mt5Path) { $diag.Mt5Path } else { "Not detected in Program Files (browse or install MT5)" }

$lblDiag = New-Object System.Windows.Forms.Label
$lblDiag.Text = "Install Folder : $($AppRoot.Path)`r`nHost Hardware  : $($diag.Cores) CPU Cores | $($diag.RamGb) GB RAM | $($diag.FreeGb) GB Free Disk (Safe Capacity: ~$($diag.SafeFollowers) MT5 Followers)`r`nNode.js Runtime: $nodeStatusText`r`nMetaTrader 5   : $mt5StatusText"
$lblDiag.Location = New-Object System.Drawing.Point(14, 24)
$lblDiag.Size = New-Object System.Drawing.Size(616, 68)
$grpCheck.Controls.Add($lblDiag)

$btnInstallNode = New-Object System.Windows.Forms.Button
$btnInstallNode.Text = "Install Node.js LTS (winget)"
$btnInstallNode.Location = New-Object System.Drawing.Point(14, 95)
$btnInstallNode.Size = New-Object System.Drawing.Size(190, 26)
$btnInstallNode.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnInstallNode.FlatStyle = "Flat"
$btnInstallNode.Enabled = (-not $diag.NodeVersion)
$grpCheck.Controls.Add($btnInstallNode)

$btnGetMt5 = New-Object System.Windows.Forms.Button
$btnGetMt5.Text = "Download Official MT5 Installer"
$btnGetMt5.Location = New-Object System.Drawing.Point(214, 95)
$btnGetMt5.Size = New-Object System.Drawing.Size(210, 26)
$btnGetMt5.BackColor = [System.Drawing.Color]::FromArgb(30, 41, 59)
$btnGetMt5.FlatStyle = "Flat"
$grpCheck.Controls.Add($btnGetMt5)

# Installation Options
$grpOpts = New-Object System.Windows.Forms.GroupBox
$grpOpts.Text = "2. Setup Options"
$grpOpts.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$grpOpts.Location = New-Object System.Drawing.Point(20, 214)
$grpOpts.Size = New-Object System.Drawing.Size(644, 130)
$form.Controls.Add($grpOpts)

$chkBuild = New-Object System.Windows.Forms.CheckBox
$chkBuild.Text = "Install dependencies (npm install) and build production dashboard (npm run build)"
$chkBuild.Checked = $true
$chkBuild.Location = New-Object System.Drawing.Point(14, 24)
$chkBuild.Size = New-Object System.Drawing.Size(600, 22)
$grpOpts.Controls.Add($chkBuild)

$chkShortcuts = New-Object System.Windows.Forms.CheckBox
$chkShortcuts.Text = "Create Desktop & Start Menu shortcuts (Start, Stop, Dashboard, Uninstall)"
$chkShortcuts.Checked = $true
$chkShortcuts.Location = New-Object System.Drawing.Point(14, 50)
$chkShortcuts.Size = New-Object System.Drawing.Size(600, 22)
$grpOpts.Controls.Add($chkShortcuts)

$chkAutoStart = New-Object System.Windows.Forms.CheckBox
$chkAutoStart.Text = "Enable Windows Task Scheduler auto-start on logon (background headless mode)"
$chkAutoStart.Checked = $false
$chkAutoStart.Location = New-Object System.Drawing.Point(14, 76)
$chkAutoStart.Size = New-Object System.Drawing.Size(600, 22)
$grpOpts.Controls.Add($chkAutoStart)

$chkPower = New-Object System.Windows.Forms.CheckBox
$chkPower.Text = "Configure 24/7 AC Power Plan (disable Sleep/Hibernate while plugged in)"
$chkPower.Checked = $true
$chkPower.Location = New-Object System.Drawing.Point(14, 102)
$chkPower.Size = New-Object System.Drawing.Size(600, 22)
$grpOpts.Controls.Add($chkPower)

# Log Console
$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.ReadOnly = $true
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(11, 15, 23)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(203, 213, 225)
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$txtLog.Location = New-Object System.Drawing.Point(20, 354)
$txtLog.Size = New-Object System.Drawing.Size(644, 130)
$form.Controls.Add($txtLog)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(20, 492)
$progress.Size = New-Object System.Drawing.Size(440, 22)
$form.Controls.Add($progress)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Install & Launch TradeSync"
$btnInstall.Location = New-Object System.Drawing.Point(474, 490)
$btnInstall.Size = New-Object System.Drawing.Size(190, 28)
$btnInstall.BackColor = [System.Drawing.Color]::FromArgb(37, 99, 235)
$btnInstall.ForeColor = [System.Drawing.Color]::White
$btnInstall.FlatStyle = "Flat"
$form.Controls.Add($btnInstall)

function Write-Log([string]$msg) {
    $txtLog.AppendText("[" + (Get-Date -Format "HH:mm:ss") + "] " + $msg + "`r`n")
    [System.Windows.Forms.Application]::DoEvents()
}

function Create-Shortcut([string]$lnkPath, [string]$targetPath, [string]$args, [string]$workDir, [string]$desc) {
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnkPath)
    $sc.TargetPath = $targetPath
    $sc.Arguments = $args
    $sc.WorkingDirectory = $workDir
    $sc.Description = $desc
    $sc.Save()
}

$btnInstallNode.Add_Click({
    Write-Log "Launching winget install OpenJS.NodeJS.LTS..."
    try {
        Start-Process -FilePath "winget" -ArgumentList "install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements" -Wait
        Write-Log "Node.js installation finished. Re-open Setup Wizard if PATH changed."
    } catch {
        Write-Log "winget unavailable. Opening https://nodejs.org/ in browser..."
        Start-Process "https://nodejs.org/"
    }
})

$btnGetMt5.Add_Click({
    Write-Log "Opening official MetaTrader 5 / Exness download page..."
    Start-Process "https://www.metatrader5.com/en/download"
})

$btnInstall.Add_Click({
    $btnInstall.Enabled = $false
    $progress.Value = 10

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Log "ERROR: Node.js is required before building. Click 'Install Node.js LTS' or install from nodejs.org."
        $btnInstall.Enabled = $true
        return
    }

    Write-Log "Ensuring .env and encrypted data/vault folders exist..."
    if (-not (Test-Path ".env")) {
        "HOST=127.0.0.1`r`nPORT=3000`r`nNODE_ENV=production" | Out-File -FilePath ".env" -Encoding ascii
    }
    New-Item -ItemType Directory -Force -Path "data", "data\vault", "data\mt5-instances" | Out-Null
    $progress.Value = 25

    if ($chkBuild.Checked) {
        Write-Log "Running npm install..."
        cmd /c "npm install" 2>&1 | ForEach-Object { Write-Log $_ }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ERROR: npm install failed."
            $btnInstall.Enabled = $true
            return
        }
        $progress.Value = 55

        Write-Log "Building frontend bundle (npm run build)..."
        cmd /c "npm run build" 2>&1 | ForEach-Object { Write-Log $_ }
        if ($LASTEXITCODE -ne 0) {
            Write-Log "ERROR: npm run build failed."
            $btnInstall.Enabled = $true
            return
        }
    }
    $progress.Value = 75

    if ($chkPower.Checked) {
        Write-Log "Configuring 24/7 AC power timeouts (sleep=never, hibernate=never)..."
        cmd /c "powercfg /change standby-timeout-ac 0" | Out-Null
        cmd /c "powercfg /change hibernate-timeout-ac 0" | Out-Null
    }

    if ($chkShortcuts.Checked) {
        Write-Log "Creating Desktop & Start Menu shortcuts..."
        $desktop = [Environment]::GetFolderPath("Desktop")
        $startMenu = Join-Path ([Environment]::GetFolderPath("Programs")) "TradeSync MT5"
        New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

        $startBat = Join-Path $ScriptDir "Start-TradeSync.bat"
        $stopBat = Join-Path $ScriptDir "Stop-TradeSync.bat"
        $uninstallBat = Join-Path $ScriptDir "Uninstall-TradeSync.bat"

        Create-Shortcut (Join-Path $desktop "TradeSync MT5.lnk") $startBat "" $AppRoot.Path "Launch TradeSync MT5 Server & Dashboard"
        Create-Shortcut (Join-Path $startMenu "TradeSync MT5.lnk") $startBat "" $AppRoot.Path "Launch TradeSync MT5 Server & Dashboard"
        Create-Shortcut (Join-Path $startMenu "Stop TradeSync MT5.lnk") $stopBat "" $AppRoot.Path "Stop TradeSync MT5"
        Create-Shortcut (Join-Path $startMenu "Uninstall TradeSync MT5.lnk") $uninstallBat "" $AppRoot.Path "Uninstall TradeSync MT5"
    }
    $progress.Value = 90

    if ($chkAutoStart.Checked) {
        Write-Log "Registering Task Scheduler auto-start (TradeSyncMT5)..."
        $startBat = Join-Path $ScriptDir "Start-TradeSync.bat"
        schtasks /Create /TN "TradeSyncMT5" /TR "`"$startBat`" --headless" /SC ONLOGON /RL HIGHEST /F | Out-Null
    }

    $progress.Value = 100
    Write-Log "Setup complete! Launching TradeSync MT5 server and opening http://127.0.0.1:3000 ..."
    Start-Process -FilePath (Join-Path $ScriptDir "Start-TradeSync.bat") -WorkingDirectory $AppRoot.Path
    $btnInstall.Text = "Installed & Running"
})

Write-Log "Welcome to TradeSync MT5 Setup Wizard."
Write-Log "Review system diagnostics above and click 'Install & Launch TradeSync'."
[void]$form.ShowDialog()
