# OCR assets

Tesseract.js 7: https://github.com/naptha/tesseract.js
Portable LSTM core: https://github.com/naptha/tesseract.js-core
English and Korean fast models: https://github.com/tesseract-ocr/tessdata_fast

The worker, embedded WebAssembly core, and two traineddata files are served locally.
No external OCR API key is required. Included licenses and LICENSES/tessdata_fast-LICENSE.txt apply.
Photos are processed in browser memory during OCR; reviewed rows are sent to the configured server when imported.
This is printed-text recognition, not translation. Handwriting and complex layouts need review.
