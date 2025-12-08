// 檔案路徑: components/PDFViewer.js
'use client';

import { useState, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export default function PDFViewer({ pdfUrl, pageNumber, bbox }) {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const [pdfDoc, setPdfDoc] = useState(null);
    const [currentPage, setCurrentPage] = useState(pageNumber || 1);
    const [scale, setScale] = useState(1.5);
    const [pageInfo, setPageInfo] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [pageHeight, setPageHeight] = useState(0);

    useEffect(() => {
        if (!pdfUrl) {
            setError('沒有提供 PDF 網址');
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError('');
        setPdfDoc(null);

        const loadingTask = pdfjsLib.getDocument({
            url: pdfUrl,
            // 添加 CMap 配置（修復字體載入問題）
            cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/cmaps/',
            cMapPacked: true
        });

        loadingTask.promise.then(doc => {
            setPdfDoc(doc);
            const initialPage = pageNumber > 0 && pageNumber <= doc.numPages ? pageNumber : 1;
            setCurrentPage(initialPage);
            setIsLoading(false);
        }).catch(err => {
            console.error("無法載入 PDF:", err);
            setError(`無法載入 PDF: ${err.message}`);
            setIsLoading(false);
        });
    }, [pdfUrl, pageNumber]);

    useEffect(() => {
        if (!pdfDoc) return;
        renderPage(currentPage);
    }, [pdfDoc, currentPage, scale]);

    const renderPage = async (pageNum) => {
        try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            const canvas = canvasRef.current;
            if (!canvas) return;

            const pageViewport = page.getViewport({ scale: 1 });
            setPageHeight(pageViewport.height);

            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            if (canvas._renderTask) {
                canvas._renderTask.cancel();
            }

            const renderTask = page.render({ canvasContext: context, viewport: viewport });
            canvas._renderTask = renderTask;

            await renderTask.promise;
            canvas._renderTask = null;

            setPageInfo(`頁碼: ${pageNum} / ${pdfDoc.numPages}`);
        } catch (err) {
            if (err.name === 'RenderingCancelledException') {
                return;
            }
            console.error("渲染失敗:", err);
            setError(`渲染頁面 ${pageNum} 失敗`);
        }
    };

    const drawBoundingBox = () => {
        const canvas = canvasRef.current;
        if (!canvas || !bbox || bbox.length !== 4 || !pageHeight) return null;

        const [x0, y0, x1, y1] = bbox;

        const style = {
            position: 'absolute',
            left: `${x0 * scale}px`,
            top: `${(pageHeight - y1) * scale}px`,
            width: `${(x1 - x0) * scale}px`,
            height: `${(y1 - y0) * scale}px`,
            border: '2px solid #ff0000',
            backgroundColor: 'rgba(255, 255, 0, 0.2)',
            pointerEvents: 'none',
            boxSizing: 'border-box'
        };

        return <div style={style}></div>;
    };

    const changePage = (offset) => {
        const newPage = currentPage + offset;
        if (pdfDoc && newPage > 0 && newPage <= pdfDoc.numPages) {
            setCurrentPage(newPage);
        }
    };

    const changeZoom = (offset) => {
        const newScale = scale + offset;
        if (newScale > 0.5 && newScale < 3) {
            setScale(newScale);
        }
    };

    return (
        <div className="collapsible">
            <div className="collapsible-header">
                <label>📄 原始 PDF 文件</label>
            </div>
            <div className="collapsible-content">
                {isLoading && <div className="pdf-status">載入中...</div>}
                {error && <div className="pdf-status" style={{background: '#fecaca', color: '#b91c1c'}}>{error}</div>}
                {pdfDoc && !error && (
                    <>
                        <div className="pdf-controls">
                            <button onClick={() => changePage(-1)} disabled={currentPage <= 1}>上一頁</button>
                            <span>{pageInfo}</span>
                            <button onClick={() => changePage(1)} disabled={currentPage >= pdfDoc.numPages}>下一頁</button>
                            <button onClick={() => changeZoom(0.2)}>放大</button>
                            <button onClick={() => changeZoom(-0.2)}>縮小</button>
                        </div>
                        <div id="pdfContainer" ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
                            <canvas ref={canvasRef}></canvas>
                            {drawBoundingBox()}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
