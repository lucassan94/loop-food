@echo off

:: 1. Fecha todas as janelas pelo título exato
taskkill /FI "WINDOWTITLE eq backend*" /F
taskkill /FI "WINDOWTITLE eq cliente*" /F
taskkill /FI "WINDOWTITLE eq entregador*" /F
taskkill /FI "WINDOWTITLE eq restaurante*" /F
taskkill /FI "WINDOWTITLE eq god*" /F

:: Pequena pausa de 2 segundos para garantir o fechamento
timeout /t 2 /nobreak >nul

:: 2. Inicializa os scripts alterando para a pasta correta antes de rodar
start "backend" /D "C:\Users\Lucas\Desktop\Restaurante\Delivery V3\backend" "run.bat"
start "cliente" /D "C:\Users\Lucas\Desktop\Restaurante\Delivery V3\cliente" "run.bat"
start "entregador" /D "C:\Users\Lucas\Desktop\Restaurante\Delivery V3\entregador" "run.bat"
start "restaurante" /D "C:\Users\Lucas\Desktop\Restaurante\Delivery V3\restaurante" "run.bat"
start "god" /D "C:\Users\Lucas\Desktop\Restaurante\Delivery V3\god" "run.bat"

