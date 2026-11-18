# Equivalente do build.sh para Windows: copia o núcleo Python para dentro do site.
$ErrorActionPreference = "Stop"
$site = $PSScriptRoot
$destino = Join-Path $site "nucleo"
if (Test-Path $destino) { Remove-Item -Recurse -Force $destino }
New-Item -ItemType Directory -Path $destino | Out-Null
Copy-Item (Join-Path $site "..\nucleo\*.py") $destino
Copy-Item (Join-Path $site "..\nucleo\fontes") (Join-Path $destino "fontes") -Recurse
$nomes = (Get-ChildItem (Join-Path $destino "*.py")).Name
[System.IO.File]::WriteAllText((Join-Path $destino "lista.txt"), (($nomes -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Núcleo copiado para site\nucleo ($($nomes.Count) arquivos)."
$v = if ($env:CF_PAGES_COMMIT_SHA) { $env:CF_PAGES_COMMIT_SHA } else { try { (git rev-parse HEAD).Trim() } catch { "dev" } }
[System.IO.File]::WriteAllText((Join-Path $site "versao.json"), ('{"versao":"' + $v.Substring(0, [Math]::Min(7, $v.Length)) + '","data":"' + (Get-Date).ToUniversalTime().ToString("yyyy-MM-dd HH:mm") + '"}' + "`n"), (New-Object System.Text.UTF8Encoding($false)))
