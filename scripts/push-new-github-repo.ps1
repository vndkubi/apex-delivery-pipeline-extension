param(
    [string]$RemoteUrl = "https://github.com/vndkubi/apex-delivery-pipeline-extension.git",

    [string]$Branch = "main",

    [string]$CommitMessage = "feat: initial apex delivery pipeline extension"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

if (-not (Test-Path ".git")) {
    git init
}

git branch -M $Branch

if (git remote get-url origin 2>$null) {
    git remote set-url origin $RemoteUrl
} else {
    git remote add origin $RemoteUrl
}

git status --short
git add .

if (git diff --cached --quiet) {
    Write-Host "No staged changes to commit."
} else {
    git commit -m $CommitMessage
}

git push -u origin $Branch