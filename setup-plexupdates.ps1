<#
.SYNOPSIS
  One-command setup for your own copy of the Plex request site (PlexUpdates)
  wired to PlexClaw.

.DESCRIPTION
  Run this from a clone of the PlexUpdates repo on Windows. It:
    1. Checks for Node, npm and Git; installs firebase-tools and vercel if missing.
    2. Asks for the admin email (you), an optional family member email (gets the
       simplified "For You" view), a TMDB API key and a project id.
    3. Creates the Firebase project, a web app and the Firestore database, and
       writes the web config plus your admin email into index.html and
       firestore.rules.
    4. Deploys the Firestore rules and the site to Vercel (production).
    5. Tells you the three console steps that have no CLI: turn on Google sign-in,
       authorize the Vercel domain, and generate the service-account key that
       PlexClaw needs for write-back.

  Re-runnable. Nothing is overwritten without a backup (index.html.bak,
  firestore.rules.bak). Use -DryRun to see every step without changing anything.

.PARAMETER DryRun
  Print what would happen; make no changes and call no network commands.

.PARAMETER PlexClawDir
  Path to the PlexClaw folder on this machine. When given, the script writes
  plexhub_project into PlexClaw's settings.json and tells you where to drop the
  service-account key.

.EXAMPLE
  .\setup-plexupdates.ps1
  .\setup-plexupdates.ps1 -DryRun
  .\setup-plexupdates.ps1 -PlexClawDir "C:\Users\me\Documents\PlexClaw"
#>
[CmdletBinding()]
param(
  [switch]$DryRun,
  [string]$PlexClawDir = "",
  [string]$ProjectId = "",
  [string]$AdminEmail = "",
  [string]$FamilyEmail = "",
  [string]$TmdbKey = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Note($text) { Write-Host "    $text" -ForegroundColor DarkGray }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Run($cmd) {
  if ($DryRun) { Write-Host "    [dry-run] $cmd" -ForegroundColor DarkYellow; return "" }
  Write-Host "    > $cmd" -ForegroundColor DarkGray
  $out = Invoke-Expression $cmd 2>&1
  if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { throw "command failed ($LASTEXITCODE): $cmd`n$out" }
  return ($out | Out-String)
}
function Sha256Lower($text) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($text.Trim().ToLowerInvariant())
  $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
  return ([BitConverter]::ToString($hash) -replace "-", "").ToLowerInvariant()
}
function Need($name, $installHint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name is not installed. $installHint"
  }
  Note "$name found: $((Get-Command $name).Source)"
}

Step "Checking prerequisites"
Need "node" "Install Node.js LTS from https://nodejs.org and re-run."
Need "npm"  "Install Node.js LTS from https://nodejs.org and re-run."
Need "git"  "Install Git from https://git-scm.com and re-run."
foreach ($tool in @(@{ cmd = "firebase"; pkg = "firebase-tools" }, @{ cmd = "vercel"; pkg = "vercel" })) {
  if (-not (Get-Command $tool.cmd -ErrorAction SilentlyContinue)) {
    Step "Installing $($tool.pkg)"
    Run "npm install -g $($tool.pkg)"
  } else { Note "$($tool.cmd) found" }
}
if (-not (Test-Path (Join-Path $Root "index.html"))) { throw "Run this from the PlexUpdates folder (index.html not found)." }

Step "A few questions"
if (-not $AdminEmail) { $AdminEmail = Read-Host "Your Google account email (this becomes the admin)" }
if (-not $AdminEmail -or $AdminEmail -notmatch "@") { throw "An admin email is required." }
if (-not $FamilyEmail) { $FamilyEmail = Read-Host "Family member's Google email for the simplified view (Enter to skip)" }
if (-not $TmdbKey) { $TmdbKey = Read-Host "TMDB API key (free at themoviedb.org/settings/api)" }
if (-not $ProjectId) {
  $suggest = "plex-requests-" + (-join ((97..122) | Get-Random -Count 5 | ForEach-Object { [char]$_ }))
  $ProjectId = Read-Host "Firebase project id (letters, digits, dashes) [$suggest]"
  if (-not $ProjectId) { $ProjectId = $suggest }
}
$ProjectId = $ProjectId.ToLowerInvariant()
Note "admin: $AdminEmail"
Note "family: $(if ($FamilyEmail) { $FamilyEmail } else { '(none)' })"
Note "project: $ProjectId"

Step "Signing in to Firebase (a browser window opens)"
Run "firebase login --no-localhost"

Step "Creating the Firebase project and web app"
$existing = ""
if (-not $DryRun) { $existing = (& firebase projects:list --json 2>$null | Out-String) }
if ($existing -match "`"projectId`":\s*`"$ProjectId`"") {
  Note "project $ProjectId already exists, reusing it"
} else {
  Run "firebase projects:create $ProjectId --display-name `"Plex Requests`""
}
Run "firebase use $ProjectId"
$appsJson = ""
if (-not $DryRun) { $appsJson = (& firebase apps:list WEB --project $ProjectId --json 2>$null | Out-String) }
if ($appsJson -notmatch "`"appId`"") {
  Run "firebase apps:create WEB `"Plex Requests Web`" --project $ProjectId"
}
$sdk = Run "firebase apps:sdkconfig WEB --project $ProjectId"

Step "Creating the Firestore database"
try { Run "firebase firestore:databases:create `"(default)`" --location nam5 --project $ProjectId" }
catch { Warn "Firestore database create returned an error (it may already exist): $($_.Exception.Message.Split([char]10)[0])" }

Step "Writing the web config, admin email and family view into the site"
$index = Get-Content -LiteralPath "index.html" -Raw
if (-not $DryRun) { Copy-Item "index.html" "index.html.bak" -Force }
if ($sdk -match "apiKey:\s*`"([^`"]+)`"") {
  $cfgBlock = ($sdk -split "`n" | Where-Object { $_ -match "^\s*(apiKey|authDomain|projectId|storageBucket|messagingSenderId|appId|measurementId)\s*:" }) -join "`n"
  $index = [regex]::Replace($index, "const firebaseConfig = \{[\s\S]*?\};", "const firebaseConfig = {`n$cfgBlock`n    };", 1)
  Note "firebaseConfig replaced"
} else { Warn "Could not read the SDK config from firebase-tools; paste it into index.html by hand (search for firebaseConfig)." }
$index = [regex]::Replace($index, "const ADMIN_EMAIL = '[^']*';", "const ADMIN_EMAIL = '$AdminEmail';", 1)
if ($FamilyEmail) {
  $hash = Sha256Lower $FamilyEmail
  $index = [regex]::Replace($index, "const MOM_EMAIL_HASH = '[0-9a-f]*';", "const MOM_EMAIL_HASH = '$hash';", 1)
  Note "family view keyed to $FamilyEmail"
}
if ($TmdbKey) { $index = [regex]::Replace($index, "const TMDB_KEY = '[^']*';", "const TMDB_KEY = '$TmdbKey';", 1) }
if (-not $DryRun) { Set-Content -LiteralPath "index.html" -Value $index -NoNewline -Encoding UTF8 }

$rules = Get-Content -LiteralPath "firestore.rules" -Raw
if (-not $DryRun) { Copy-Item "firestore.rules" "firestore.rules.bak" -Force }
$rules = [regex]::Replace($rules, "request\.auth\.token\.email == '[^']+'", "request.auth.token.email == '$AdminEmail'", 1)
if (-not $DryRun) { Set-Content -LiteralPath "firestore.rules" -Value $rules -NoNewline -Encoding UTF8 }
if (-not $DryRun) { Set-Content -LiteralPath ".firebaserc" -Value ("{ `"projects`": { `"default`": `"$ProjectId`" } }") -Encoding UTF8 }

Step "Deploying Firestore rules"
Run "firebase deploy --only firestore:rules --project $ProjectId"

Step "Deploying the site to Vercel (production)"
Run "vercel login"
$deploy = Run "vercel --prod --yes"
$siteUrl = ""
if ($deploy -match "(https://[a-z0-9\-]+\.vercel\.app)") { $siteUrl = $Matches[1] }
if ($siteUrl) { Note "live at $siteUrl" }

if ($PlexClawDir) {
  Step "Pointing PlexClaw at this project"
  $settings = Join-Path $PlexClawDir "settings.json"
  if (Test-Path $settings) {
    if (-not $DryRun) {
      $json = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
      $json | Add-Member -NotePropertyName plexhub_project -NotePropertyValue $ProjectId -Force
      $json | Add-Member -NotePropertyName plexhub_enabled -NotePropertyValue $true -Force
      $json | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $settings -Encoding UTF8
    }
    Note "plexhub_project = $ProjectId written to $settings"
  } else { Warn "settings.json not found in $PlexClawDir; set plexhub_project in PlexClaw > Settings > Family requests instead." }
}

Step "Three things only the Firebase console can do"
Write-Host "    1. Authentication > Sign-in method > Google > Enable (pick a support email)."
Write-Host "    2. Authentication > Settings > Authorized domains > add: $(if ($siteUrl) { $siteUrl -replace 'https://', '' } else { 'your-site.vercel.app' })"
Write-Host "    3. Project settings > Service accounts > Generate new private key, save it as:"
Write-Host "         $(if ($PlexClawDir) { Join-Path $PlexClawDir 'data\plexhub_service_account.json' } else { '<PlexClaw>\data\plexhub_service_account.json' })"
Write-Host "       That file lets PlexClaw mark requests as On Plex, publish the library, and drive the admin dashboard."
Write-Host ""
Write-Host "    Console: https://console.firebase.google.com/project/$ProjectId/overview"
if ($siteUrl) { Write-Host "    Site:    $siteUrl" }
Write-Host ""
Write-Host "Done." -ForegroundColor Green
