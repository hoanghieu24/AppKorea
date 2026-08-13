param(
  [string]$RepoPath = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$RepoPath = (Resolve-Path $RepoPath).Path
$Here = $PSScriptRoot

if (-not (Test-Path (Join-Path $RepoPath 'frontend\src\pages\AssignmentsPage.jsx'))) {
  throw "Không thấy repo AppKorea tại: $RepoPath. Hãy cd vào thư mục AppKorea rồi chạy lại script."
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $RepoPath ".appkorea-patch-backup-$stamp"
New-Item -ItemType Directory -Path $backup -Force | Out-Null

$filesToBackup = @(
  'frontend\src\pages\AssignmentsPage.jsx',
  'frontend\src\pages\LearningHubPage.jsx',
  'frontend\src\components\Shell.jsx',
  'frontend\src\styles.css',
  'frontend\package.json'
)
foreach ($rel in $filesToBackup) {
  $src = Join-Path $RepoPath $rel
  if (Test-Path $src) {
    $dst = Join-Path $backup $rel
    New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
    Copy-Item $src $dst -Force
  }
}

Copy-Item (Join-Path $Here 'frontend\src\pages\AssignmentsPage.jsx') (Join-Path $RepoPath 'frontend\src\pages\AssignmentsPage.jsx') -Force
Copy-Item (Join-Path $Here 'frontend\src\pages\LearningHubPage.jsx') (Join-Path $RepoPath 'frontend\src\pages\LearningHubPage.jsx') -Force
Copy-Item (Join-Path $Here 'frontend\src\components\Shell.jsx') (Join-Path $RepoPath 'frontend\src\components\Shell.jsx') -Force

$legacyTarget = Join-Path $RepoPath 'frontend\public\legacy'
New-Item -ItemType Directory -Path $legacyTarget -Force | Out-Null
Copy-Item (Join-Path $Here 'frontend\public\legacy\*') $legacyTarget -Recurse -Force

$stylesPath = Join-Path $RepoPath 'frontend\src\styles.css'
$styles = Get-Content $stylesPath -Raw -Encoding UTF8
$append = Get-Content (Join-Path $Here 'styles-append.css') -Raw -Encoding UTF8
if ($styles -notmatch 'v2\.2\.9: 4 cách nhập câu') {
  Add-Content -Path $stylesPath -Value $append -Encoding UTF8
}

$pkgPath = Join-Path $RepoPath 'frontend\package.json'
$pkg = Get-Content $pkgPath -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $pkg.dependencies) { $pkg | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }
if (-not ($pkg.dependencies.PSObject.Properties.Name -contains 'xlsx')) {
  $pkg.dependencies | Add-Member -NotePropertyName 'xlsx' -NotePropertyValue '^0.18.5'
} else { $pkg.dependencies.xlsx = '^0.18.5' }
if (-not ($pkg.dependencies.PSObject.Properties.Name -contains 'tesseract.js')) {
  $pkg.dependencies | Add-Member -NotePropertyName 'tesseract.js' -NotePropertyValue '^6.0.1'
} else { $pkg.dependencies.'tesseract.js' = '^6.0.1' }
$pkg | ConvertTo-Json -Depth 30 | Set-Content $pkgPath -Encoding UTF8

Write-Host ''
Write-Host '✅ Đã áp dụng AppKorea feature patch v2.2.9' -ForegroundColor Green
Write-Host "📦 Backup: $backup"
Write-Host ''
Write-Host 'Tiếp theo chạy:' -ForegroundColor Cyan
Write-Host '  cd frontend'
Write-Host '  npm install'
Write-Host '  npm run build'
Write-Host ''
Write-Host 'Nếu build OK: git add . && git commit -m "Add assignment import modes and learning room" && git push'
