param(
    [Parameter(Mandatory = $true)]
    [string]$Destination,
    [string]$Branch = 'master'
)

$ErrorActionPreference = 'Stop'
$sourceRepo = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$destinationPath = if ([System.IO.Path]::IsPathRooted($Destination)) { $Destination } else { Join-Path (Get-Location).Path $Destination }
$publicationRepo = [System.IO.Path]::GetFullPath($destinationPath)
if ($publicationRepo.Equals($sourceRepo, [System.StringComparison]::OrdinalIgnoreCase) -or
    $publicationRepo.StartsWith($sourceRepo + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Use a destination outside the working repository.'
}
if (Test-Path -LiteralPath $publicationRepo) {
    throw 'The destination already exists. Choose a new directory; this script never deletes an existing copy.'
}

function Invoke-Git {
    param([string]$Repo, [string[]]$GitArgs)
    $result = & git -C $Repo @GitArgs
    if ($LASTEXITCODE -ne 0) { throw "Git failed: $($GitArgs[0])" }
    return $result
}

& python -m git_filter_repo --version
if ($LASTEXITCODE -ne 0) {
    throw 'Install the history tool first: python -m pip install --user git-filter-repo==2.47.0'
}
$null = Invoke-Git -Repo $sourceRepo -GitArgs @('check-ref-format', '--branch', $Branch)
$sourceCommit = Invoke-Git -Repo $sourceRepo -GitArgs @('rev-parse', $Branch)

& git clone --no-local --no-tags --single-branch --branch $Branch -- $sourceRepo $publicationRepo
if ($LASTEXITCODE -ne 0) { throw 'Publication clone failed.' }
$clonedCommit = Invoke-Git -Repo $publicationRepo -GitArgs @('rev-parse', 'HEAD')
if ($clonedCommit -ne $sourceCommit) { throw 'The source branch changed while cloning. Do not publish this copy; retry into a new destination.' }

Push-Location -LiteralPath $publicationRepo
try {
    & python -m git_filter_repo --path scanner/AxInterop.ZKFPEngXControl.dll --path scanner/Interop.ZKFPEngXControl.dll --invert-paths
    if ($LASTEXITCODE -ne 0) { throw 'History filtering failed. Do not publish this copy.' }

    $refs = @(Invoke-Git -Repo $publicationRepo -GitArgs @('for-each-ref', '--format=%(refname)'))
    if ($refs.Count -ne 1 -or $refs[0] -ne "refs/heads/$Branch") {
        throw 'Unexpected publication refs. Do not publish this copy.'
    }
    $objects = @(Invoke-Git -Repo $publicationRepo -GitArgs @('rev-list', '--objects', '--all'))
    if ($objects | Select-String -Quiet -Pattern ' (scanner/(AxInterop|Interop)\.ZKFPEngXControl\.dll|attendance\.config\.json|.*service-account.*\.json)$') {
        throw 'Disallowed file remains in reachable history. Do not publish this copy.'
    }

    $secretPattern = '-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|"private_key"\s*:|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}'
    foreach ($revision in (Invoke-Git -Repo $publicationRepo -GitArgs @('rev-list', '--all'))) {
        $null = & git -C $publicationRepo grep -I -l -E -- $secretPattern $revision
        if ($LASTEXITCODE -eq 0) { throw 'A possible secret remains in history. Review privately before publication.' }
        if ($LASTEXITCODE -ne 1) { throw 'History secret scan failed.' }
    }
    $messages = Invoke-Git -Repo $publicationRepo -GitArgs @('log', '--all', '--format=%B')
    if (($messages -join "`n") -match $secretPattern) {
        throw 'A possible secret remains in commit messages. Review privately before publication.'
    }
    $remotes = @(Invoke-Git -Repo $publicationRepo -GitArgs @('remote'))
    if ($remotes.Count) { throw 'The publication copy unexpectedly retains a remote.' }
    $null = Invoke-Git -Repo $publicationRepo -GitArgs @('fsck', '--no-reflogs')
    Write-Output "Prepared $publicationRepo from $sourceCommit. Only $Branch is included; interop DLL history is removed. No remote or push was created."
}
finally {
    Pop-Location
}
