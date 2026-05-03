const puppeteer = require('puppeteer');

async function testPuppeteer() {
  console.log('Тестирование Puppeteer...');
  
  try {
    // Запускаем браузер с расширенными параметрами для Windows
    console.log('Запуск браузера...');
    const browser = await puppeteer.launch({
      headless: "new",
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ],
      ignoreHTTPSErrors: true
    });
    
    console.log('Браузер запущен успешно!');
    
    // Создаем новую страницу
    console.log('Создание новой страницы...');
    const page = await browser.newPage();
    console.log('Страница создана успешно');
    
    // Переходим на простую страницу
    console.log('Переход на страницу...');
    await page.goto('https://example.com', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    console.log('Страница загружена успешно');
    
    // Получаем заголовок страницы
    const title = await page.title();
    console.log(`Заголовок страницы: ${title}`);
    
    // Закрываем браузер
    console.log('Закрытие браузера...');
    await browser.close();
    console.log('Браузер закрыт');
    
    console.log('Тест завершен успешно!');
  } catch (error) {
    console.error('Ошибка при тестировании Puppeteer:', error);
  }
}

// Запускаем тест
testPuppeteer().catch(error => {
  console.error('Неперехваченная ошибка в тесте Puppeteer:', error);
  process.exit(1);
}); 