// 檔案路徑: app/admin/page.js
'use client';

import { useState, useEffect, useRef } from 'react';
import { getProjectsWithProgress } from '../actions';
import { deleteProject, saveProjectData, updateProjectOffset, repairProjectPdfs, diagnoseProject, exportProjectAnnotations } from '../adminActions';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';

export default function AdminPage() {
    const [user, setUser] = useState(null);
    const [projects, setProjects] = useState([]);
    const [message, setMessage] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [selectedFiles, setSelectedFiles] = useState({ json: null, pdfs: [] });
    const [startPage, setStartPage] = useState(10);
    const formRef = useRef(null);
    const router = useRouter();

    useEffect(() => {
        const savedUser = localStorage.getItem('annotatorUser');
        if (savedUser) {
            const parsedUser = JSON.parse(savedUser);
            if (parsedUser.role !== 'admin') {
                alert('權限不足，將返回主頁面');
                router.push('/');
            } else {
                setUser(parsedUser);
                loadProjects(parsedUser.id);
            }
        } else {
             alert('請先登入');
             router.push('/');
        }
    }, [router]);

    const loadProjects = async (userId) => {
        const data = await getProjectsWithProgress(userId); 
        if(data.projects) setProjects(data.projects);
    };

    const handleDelete = async (projectId) => {
        if (window.confirm('確定要刪除這個專案嗎？這將永久移除所有相關資料！')) {
            const result = await deleteProject(user.id, projectId);
            if (result.success) {
                alert('刪除成功');
                loadProjects(user.id);
            } else {
                alert(`刪除失敗: ${result.error}`);
            }
        }
    };

    const handleUpdateOffset = async (projectId, newStartPage) => {
        const parsed = parseInt(newStartPage, 10);
        if (isNaN(parsed) || parsed < 1) {
            alert('請輸入有效的頁碼（≥1）');
            loadProjects(user.id);
            return;
        }

        const offset = parsed - 1;
        const result = await updateProjectOffset(user.id, projectId, offset);
        
        if (result.success) {
            if (result.message) {
                alert(result.message);
            }
            setProjects(prevProjects => prevProjects.map(p => 
                p.id === projectId ? { ...p, page_offset: offset } : p
            ));
        } else {
            alert(`更新失敗: ${result.error}`);
            loadProjects(user.id);
        }
    };

    const handleRepairPdfs = async (projectId) => {
        if (window.confirm('確定要修復此專案的 PDF 對應嗎？')) {
            const result = await repairProjectPdfs(user.id, projectId);
            if (result.success) {
                alert(result.message || '修復成功！');
                loadProjects(user.id);
            } else {
                alert(`修復失敗: ${result.error}`);
            }
        }
    };

    const handleDiagnose = async (projectId) => {
        const result = await diagnoseProject(user.id, projectId);
        if (result.success) {
            const d = result.data;
            const pdfPages = d.project.pdf_urls ? Object.keys(d.project.pdf_urls).map(Number).sort((a,b) => a-b) : [];
            const minPage = pdfPages.length > 0 ? Math.min(...pdfPages) : 0;
            const maxPage = pdfPages.length > 0 ? Math.max(...pdfPages) : 0;
            
            const info = `
═══════════════════════════════════
專案診斷報告
═══════════════════════════════════

【專案資訊】
名稱: ${d.project.name}
Page Offset: ${d.project.page_offset}
PDF URLs 數量: ${d.project.pdf_urls_count}

【PDF 頁碼範圍】
最小頁: ${minPage}
最大頁: ${maxPage}
範圍: ${minPage} ~ ${maxPage}

【統計】
總資料: ${d.stats.total}
有 URL: ${d.stats.has_url}
無 URL: ${d.stats.no_url}

【前 5 筆資料】
${d.sample_data.map(item => 
  `ID: ${item.id}, page_number: ${item.page_number}, 需要 PDF page: ${item.page_number + (d.project.page_offset || 0)}, URL: ${item.source_url ? '✓' : '✗'}`
).join('\n')}

【建議】
若要讓 page_number=1 對應到 page_${minPage}.pdf
請設定「報告起始頁」= ${minPage}
            `;
            alert(info);
        } else {
            alert(`診斷失敗: ${result.error}`);
        }
    };

    const handleExport = async (projectId, projectName) => {
        const result = await exportProjectAnnotations(user.id, projectId);
        if (result.success) {
            // 轉換為 CSV 格式
            const data = result.data;
            if (data.length === 0) {
                alert('此專案沒有標註資料');
                return;
            }

            // CSV 標題
            const headers = [
                'id', 'source_data_id', 'user_id', 'username', 'esg_type',
                'promise_status', 'promise_string', 'verification_timeline',
                'evidence_status', 'evidence_string', 'evidence_quality',
                'status', 'created_at', 'updated_at', 'page_number', 'original_data'
            ];

            // 生成 CSV 內容
            const csvContent = [
                headers.join(','),
                ...data.map(row => [
                    row.id,
                    row.source_data_id,
                    row.user_id,
                    `"${row.username}"`,
                    `"${Array.isArray(row.esg_type) ? row.esg_type.join(';') : row.esg_type}"`,
                    `"${row.promise_status || ''}"`,
                    `"${(row.promise_string || '').replace(/"/g, '""')}"`,
                    `"${row.verification_timeline || ''}"`,
                    `"${row.evidence_status || ''}"`,
                    `"${(row.evidence_string || '').replace(/"/g, '""')}"`,
                    `"${row.evidence_quality || ''}"`,
                    `"${row.status || ''}"`,
                    `"${row.created_at}"`,
                    `"${row.updated_at}"`,
                    row.page_number,
                    `"${(row.original_data || '').replace(/"/g, '""')}"`
                ].join(','))
            ].join('\n');

            // 下載 CSV
            const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', `${projectName}_annotations_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            alert(`成功匯出 ${data.length} 筆標註資料`);
        } else {
            alert(`匯出失敗: ${result.error}`);
        }
    };

    const handleJsonChange = (e) => {
        const file = e.target.files[0];
        setSelectedFiles(prev => ({ ...prev, json: file }));
    };

    const handlePdfFolderChange = (e) => {
        const files = Array.from(e.target.files).filter(f => f.name.endsWith('.pdf'));
        setSelectedFiles(prev => ({ ...prev, pdfs: files }));
        setMessage(`已選擇 ${files.length} 個 PDF 檔案`);
    };

    const handleUpload = async (event) => {
        event.preventDefault();
        if (!user) return;

        if (!selectedFiles.json) {
            setMessage('請選擇 JSON 檔案');
            return;
        }

        if (selectedFiles.pdfs.length === 0) {
            setMessage('請選擇包含 PDF 的資料夾');
            return;
        }

        setIsUploading(true);
        setMessage('');
        
        try {
            const jsonText = await selectedFiles.json.text();
            const jsonData = JSON.parse(jsonText);
            
            setUploadProgress(`正在上傳 ${selectedFiles.pdfs.length} 個 PDF...`);
            const pageUrlMap = {};
            
            for (let i = 0; i < selectedFiles.pdfs.length; i++) {
                const pdfFile = selectedFiles.pdfs[i];
                const pageMatch = pdfFile.name.match(/page_(\d+)\.pdf$/);
                
                if (pageMatch) {
                    const pageNumber = parseInt(pageMatch[1], 10);
                    setUploadProgress(`上傳: ${i + 1}/${selectedFiles.pdfs.length} - ${pdfFile.name}`);
                    
                    const blob = await upload(pdfFile.name, pdfFile, {
                        access: 'public',
                        handleUploadUrl: '/api/upload',
                    });
                    
                    pageUrlMap[pageNumber] = blob.url;
                }
            }
            
            setUploadProgress('儲存資料到資料庫...');
            const projectName = selectedFiles.json.name.replace('esg_annotation_', '').replace('.json', '');
            
            const result = await saveProjectData(user.id, {
                projectName,
                jsonData,
                pageUrlMap,
                startPage
            });
            
            setIsUploading(false);
            setUploadProgress('');
            
            if (result.success) {
                setMessage(result.message || '上傳成功！');
                setSelectedFiles({ json: null, pdfs: [] });
                setStartPage(10);
                formRef.current.reset();
                await loadProjects(user.id);
            } else {
                setMessage(`失敗: ${result.error}`);
            }
        } catch (error) {
            setIsUploading(false);
            setUploadProgress('');
            setMessage(`錯誤: ${error.message}`);
            console.error('Upload error:', error);
        }
    };

    if (!user) return <div className="container"><h1>驗證中...</h1></div>;

    return (
        <div className="container">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
                <h1>管理員後台</h1>
                <button className="btn" onClick={() => router.push('/')}>返回標註</button>
            </div>

            <div className="panel">
                <h2>上傳新專案</h2>
                <p className="hint">
                    JSON 格式：esg_annotation_專案名.json<br/>
                    PDF 檔名：專案名_page_X.pdf
                </p>
                <form ref={formRef} onSubmit={handleUpload} style={{ marginTop: '15px' }}>
                    <div className="field">
                        <label>JSON 資料檔</label>
                        <input 
                            type="file" 
                            accept=".json" 
                            onChange={handleJsonChange}
                            required 
                            disabled={isUploading} 
                        />
                        {selectedFiles.json && (
                            <p className="hint" style={{marginTop: '5px', color: 'green'}}>
                                ✓ {selectedFiles.json.name}
                            </p>
                        )}
                    </div>
                    
                    <div className="field">
                        <label>PDF 資料夾</label>
                        <input 
                            type="file" 
                            webkitdirectory="true"
                            directory="true"
                            multiple
                            onChange={handlePdfFolderChange}
                            required 
                            disabled={isUploading} 
                        />
                        {selectedFiles.pdfs.length > 0 && (
                            <p className="hint" style={{marginTop: '5px', color: 'green'}}>
                                ✓ {selectedFiles.pdfs.length} 個 PDF
                            </p>
                        )}
                    </div>

                    <div className="field">
                        <label>JSON 第 1 頁對應到哪個 PDF？</label>
                        <input 
                            type="number" 
                            min="1"
                            value={startPage}
                            onChange={(e) => setStartPage(parseInt(e.target.value) || 1)}
                            disabled={isUploading}
                            style={{
                                width: '100px',
                                padding: '8px',
                                border: '1px solid #ccc',
                                borderRadius: '4px'
                            }}
                        />
                        <p className="hint" style={{marginTop: '5px'}}>
                            例如：JSON page_number=1 要看 page_10.pdf，請輸入 10
                        </p>
                    </div>
                    
                    <button type="submit" className="btn btn-success" disabled={isUploading}>
                        {isUploading ? '上傳中...' : '上傳專案'}
                    </button>
                    
                    {uploadProgress && (
                        <p className="hint" style={{marginTop: '10px', color: 'blue'}}>
                            {uploadProgress}
                        </p>
                    )}
                    {message && (
                        <p className="hint" style={{
                            marginTop: '10px',
                            color: message.includes('失敗') || message.includes('錯誤') ? 'red' : 'green'
                        }}>
                            {message}
                        </p>
                    )}
                </form>
            </div>
            
            <div className="panel" style={{marginTop: '20px'}}>
                <h2>專案列表</h2>
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                    <thead>
                        <tr style={{borderBottom: '1px solid #ddd'}}>
                            <th style={{textAlign: 'left', padding: '8px'}}>專案名稱</th>
                            <th style={{textAlign: 'left', padding: '8px'}}>總任務</th>
                            <th style={{textAlign: 'center', padding: '8px'}}>報告起始頁</th>
                            <th style={{textAlign: 'left', padding: '8px'}}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map(p => (
                            <tr key={p.id} style={{borderBottom: '1px solid #eee'}}>
                                <td style={{padding: '8px'}}>{p.name}</td>
                                <td style={{padding: '8px'}}>{p.total_tasks}</td>
                                <td style={{padding: '8px', textAlign: 'center'}}>
                                    <input 
                                        type="number"
                                        defaultValue={p.page_offset !== null && p.page_offset !== undefined ? (p.page_offset + 1) : 1}
                                        onBlur={(e) => handleUpdateOffset(p.id, e.target.value)}
                                        style={{
                                            width: '60px', 
                                            padding: '4px', 
                                            textAlign: 'center', 
                                            border: '1px solid #ccc', 
                                            borderRadius: '4px'
                                        }}
                                        min="1"
                                    />
                                </td>
                                <td style={{padding: '8px'}}>
                                    <button 
                                        className="btn" 
                                        onClick={() => handleDiagnose(p.id)}
                                        style={{
                                            background: '#8b5cf6',
                                            color: 'white',
                                            marginRight: '10px',
                                            fontSize: '12px',
                                            padding: '6px 12px'
                                        }}
                                    >
                                        診斷
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={() => handleRepairPdfs(p.id)}
                                        style={{
                                            background: '#3b82f6',
                                            color: 'white',
                                            marginRight: '10px',
                                            fontSize: '12px',
                                            padding: '6px 12px'
                                        }}
                                    >
                                        修復
                                    </button>
                                    <button
                                        className="btn"
                                        onClick={() => handleExport(p.id, p.name)}
                                        style={{
                                            background: '#10b981',
                                            color: 'white',
                                            marginRight: '10px',
                                            fontSize: '12px',
                                            padding: '6px 12px'
                                        }}
                                    >
                                        📥 匯出
                                    </button>
                                    <button
                                        className="btn highlight-btn-clear"
                                        onClick={() => handleDelete(p.id)}
                                        style={{
                                            fontSize: '12px',
                                            padding: '6px 12px'
                                        }}
                                    >
                                        刪除
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {projects.length === 0 && (
                    <p style={{padding: '15px', textAlign: 'center'}}>沒有專案</p>
                )}
            </div>
        </div>
    );
}