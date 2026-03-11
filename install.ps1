$ErrorActionPreference = "Stop"

Set-Location $PSScriptRoot

$supported = @("3.10", "3.11", "3.12", "3.13")

function Get-SupportedPython {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($version in $supported) {
            try {
                & py "-$version" -c "import sys" *> $null
                if ($LASTEXITCODE -eq 0) {
                    return @{
                        Command = "py"
                        Args = @("-$version")
                        Label = "py -$version"
                    }
                }
            } catch {
            }
        }
    }

    foreach ($command in @("python3.13", "python3.12", "python3.11", "python3.10", "python3", "python")) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            continue
        }

        try {
            $version = & $command -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"
            if ($LASTEXITCODE -eq 0 -and $supported -contains $version.Trim()) {
                return @{
                    Command = $command
                    Args = @()
                    Label = $command
                }
            }
        } catch {
        }
    }

    return $null
}

$python = Get-SupportedPython
if ($null -eq $python) {
    Write-Error "Python 3.10 through 3.13 is required to install MusicBot."
}

Write-Host "Using '$($python.Label)' to install MusicBot dependencies..."
& $python.Command @($python.Args) -m pip install --upgrade -r requirements.lock

if (-not (Test-Path "config/options.ini")) {
    Copy-Item "config/1_options.ini" "config/options.ini"
}

Write-Host ""
Write-Host "Install complete."
Write-Host "Next steps:"
Write-Host "  1. Edit config/options.ini"
Write-Host "  2. Run: $($python.Label) run.py"
