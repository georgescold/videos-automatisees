@echo off
chcp 65001 >nul
title Usine a videos - chaine amour
cd /d "%~dp0"

echo.
echo   ================================================
echo     USINE A VIDEOS - chaine amour
echo   ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] Node.js est introuvable.
  echo       Installe-le depuis https://nodejs.org puis relance ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   [*] Premiere utilisation : installation des dependances...
  echo       Cela peut prendre une ou deux minutes.
  echo.
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo   [X] L'installation a echoue. Lis les messages ci-dessus.
    echo.
    pause
    exit /b 1
  )
  echo.
)

if not exist ".env" (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo   [!] Un fichier .env vient d'etre cree.
    echo       Ouvre-le et renseigne ELEVENLABS_API_KEY et PEXELS_API_KEY,
    echo       sinon la production s'arretera sur une cle manquante.
    echo.
  )
)

echo   [*] Ouverture de l'interface sur http://127.0.0.1:4400
echo       Laisse cette fenetre ouverte pendant que tu travailles.
echo       Ferme-la ou fais Ctrl+C pour arreter.
echo.

start "" "http://127.0.0.1:4400"
call npm run ui

echo.
echo   Serveur arrete.
pause
