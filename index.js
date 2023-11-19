import log4js from 'log4js';
import imgToPDF from 'image-to-pdf';
import fetch from 'node-fetch';
import { mkdir, stat, writeFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
const DEFAULT_OUTPUT_FOLDER = 'output';
const DEFAULT_OUTPUT_BOOK_FILE = 'result-book.pdf';
const DEFAULT_TEMP_FOLDER = 'book-images';
const MAX_PAGES = 500;
const FAILED_PAGES_FOR_END = 3;
const MIN_CONTENT_LENGTH = 10000;

const log = log4js.getLogger();
log.level = 'debug';

const _getParams = () => {
    /*
        ожидаемые параметры
        1 - URL книги
        2 - название файла
        3 - название выходного файла
        4 - название каталога временного хранения изображений
        5 - название выходного каталога
    */
    if (process.argv.length <= 2) {
        log.error('Не указана ссылка-источник книги');
        process.exit(1);
    }
    const sourceUrl = process.argv[2];

    let outputDir, outputFile, tempFolder;
    if (process.argv.length <= 3) {
        tempFolder = DEFAULT_TEMP_FOLDER;
        outputDir = DEFAULT_OUTPUT_FOLDER;
        outputFile = DEFAULT_OUTPUT_BOOK_FILE;

        return {sourceUrl, outputDir, outputFile, tempFolder};
    }
    outputFile = process.argv[3];

    if (process.argv.length <= 4) {
        tempFolder = DEFAULT_TEMP_FOLDER;
        outputDir = DEFAULT_OUTPUT_FOLDER;

        return {sourceUrl, outputDir, outputFile, tempFolder};
    }
    outputDir = process.argv[4];

    if (process.argv.length <= 5) {
        tempFolder = DEFAULT_TEMP_FOLDER;

        return {sourceUrl, outputDir, outputFile, tempFolder};
    }
    tempFolder = process.argv[5];


    return {sourceUrl, outputDir, outputFile, tempFolder};
};

const _createDirectory = async (path) => {
    try {
        await mkdir(path);
    } catch (error) {
        log.error('Ошибка создания папки', error);
    }
};

const _checkFoder = async (path) => {
    try {
        await stat(path);
        log.debug('Папка', path, 'уже существует');
    } catch (error) {
        if (!error.code) {
            log.error('Ошибка проверки папки', error);
            return;
        }

        await _createDirectory(path);
    }
};

const _removeDirectory = async (path) => {
    try {
        await rm(path, { recursive: true, force: true });
    } catch (error) {
        if (error.code !== 'ENOENT') {
            log.error('Ошибка удаления папки', error);
        }
    }
};

const _formatUrl = (rawUrl, pagesFetched) => {
    let pageStr = '' + pagesFetched;
    while (pageStr.length < 4) {
        pageStr = '0' + pageStr;
    }
    const fileName = `${pageStr}.jpg`;
    const formattedUrl = `${rawUrl}/${fileName}`;

    return {formattedUrl, fileName};
};

const _randomDelay = async () => {
    await new Promise(resolve => {
        const delay = Math.random() * 1200;
        setTimeout(() => {
            resolve();
        }, delay);
    });
};

const _fetchFiles = async (sourceUrl, tempFolder, outputDir) => {
    const sourceFiles = [];
    log.debug('Начинаем загрузку файлов');
    _checkFoder(tempFolder);
    _checkFoder(outputDir);
    let done;
    let pagesFetched = -1;
    /*
        Конец загрузки определим по нескольким неудачным попыткам загрузки страниц,
        так как в середине книги могут встречаться одиночные пустые страницы
    */
    let failedPages = 0;
    while (!done) {
        pagesFetched++;

        if (pagesFetched >= MAX_PAGES) {
            done = true;
        } else {
            const {formattedUrl, fileName} = _formatUrl(sourceUrl, pagesFetched);
            log.debug('Запрашиваем ', formattedUrl);
            try {
                const response = await fetch(formattedUrl);    
                const contentLength = parseInt(response.headers.get('content-length'));
                if (contentLength <= MIN_CONTENT_LENGTH) {
                    log.warn('Загружена пустая страница');
                    failedPages++;
                    done = failedPages >= FAILED_PAGES_FOR_END;
                } else {
                    failedPages = 0;

                    const buf = await response.arrayBuffer();
                    await writeFile(`${tempFolder}/${fileName}`, Buffer.from(buf));
                    sourceFiles.push(fileName);

                    await _randomDelay();
                }
            } catch (error) {
                log.error('Ошибка загрузки файла', error);
            }
        }
    }

    log.debug('Загрузка файлов окончена');

    return sourceFiles;
};

const _saveToPdf = async (tempFolder, sourceFiles, outputDir, outputFile) => {
    log.debug('Начинаем сохранять в файл');
    const pages = sourceFiles.map(fileName => `${tempFolder}/${fileName}`);
     
    imgToPDF(pages, imgToPDF.sizes.A4)
        .pipe(createWriteStream(`${outputDir}/${outputFile}`))

    log.debug('Сохранение в файл окончено');
};

const app = async () => {
    log.debug('Скачиватель книг запущен');
    const {sourceUrl, outputDir, outputFile, tempFolder} = _getParams();
    log.info('Источник книги', sourceUrl);
    log.debug('Результаты будут временно храниться в', tempFolder);
    log.info('Папка с результатом', outputDir);
    log.info('Файл с результатом', outputFile);

    try {
       const sourceFiles = await _fetchFiles(sourceUrl, tempFolder, outputDir);
       const result = await _saveToPdf(tempFolder, sourceFiles, outputDir, outputFile);
    } catch (error) {
        log.error('Ошибка выполнения программы', error);
    } finally {
        _removeDirectory(tempFolder);
    }
};

app();