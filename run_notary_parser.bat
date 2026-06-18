@echo off
cd /d "c:\Users\Zhanibek\Desktop\Сайт ZakonExpert"
python -c "import sys, io; sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8'); exec(open('parse_notary.py', encoding='utf-8').read())" >> parser_log.txt 2>&1
echo [%date% %time%] Parser finished >> parser_log.txt
