// 檔案路徑: app/admin/page.js
'use client';

import { useState, useEffect, useRef } from 'react';
import { getProjectsWithProgress, getAllUsersProgress } from '../actions';
import { deleteProject, saveProjectData, updateProjectOffset, diagnoseProject, exportProjectAnnotations } from '../adminActions';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';

export default function AdminPage() {
    const [user, setUser] = useState(null);
    const [projects, setProjects] = useState([]);
    const [allUsersProgress, setAllUsersProgress] = useState([]);
    const [showProgressView, setShowProgressView] = useState(false);
    const [message, setMessage] = useState('');
    const [isUploading, setIsUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState('');
    const [selectedFiles, setSelectedFiles] = useState({ json: null, pdfs: [] });
    const [showAlignmentTool, setShowAlignmentTool] = useState(false);
    const [alignmentData, setAlignmentData] = useState(null);
    const [previewStartPage, setPreviewStartPage] = useState(10);
    const [selectedJsonIndex, setSelectedJsonIndex] = useState(0);
    const [selectedPdfPage, setSelectedPdfPage] = useState(10);
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

    const loadAllUsersProgress = async () => {
        const result = await getAllUsersProgress();
        if (result.success) {
            setAllUsersProgress(result.data);
        } else {
            alert(`無法載入進度資料: ${result.error}`);
        }
    };

    const handleDelete = async (projectId) => {
        if (window.confirm('確定要刪除這個專案嗎？\n\n這將永久移除：\n• 資料庫中的所有資料\n• Vercel Blob 中的所有 PDF 檔案\n• 所有相關的標註記錄\n\n此操作無法復原！')) {
            setIsUploading(true);
            setUploadProgress('正在刪除專案資料...');

            const result = await deleteProject(user.id, projectId);

            setIsUploading(false);
            setUploadProgress('');

            if (result.success) {
                alert(result.message || '刪除成功');
                loadProjects(user.id);
            } else {
                alert(`刪除失敗: ${result.error}`);
            }
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

    const handleConfirmAlignment = async () => {
        if (!alignmentData) return;

        // 驗證 previewStartPage 是否為有效整數
        const validatedStartPage = parseInt(previewStartPage, 10);
        if (isNaN(validatedStartPage) || validatedStartPage < 1) {
            alert('請輸入有效的起始頁碼（必須是 ≥1 的整數）');
            return;
        }

        setIsUploading(true);
        setMessage('');

        try {
            setUploadProgress('儲存資料到資料庫...');

            // 如果是調整現有專案，使用 updateProjectOffset
            if (alignmentData.isAdjustment && alignmentData.projectId) {
                const offset = validatedStartPage - 1;
                const result = await updateProjectOffset(user.id, alignmentData.projectId, offset);

                setIsUploading(false);
                setUploadProgress('');

                if (result.success) {
                    alert(result.message || '對齊設定已更新！');
                    setShowAlignmentTool(false);
                    setAlignmentData(null);
                    await loadProjects(user.id);
                } else {
                    alert(`更新失敗: ${result.error}`);
                }
            } else {
                // 新專案上傳
                const result = await saveProjectData(user.id, {
                    projectName: alignmentData.projectName,
                    jsonData: alignmentData.jsonData,
                    pageUrlMap: alignmentData.pageUrlMap,
                    startPage: validatedStartPage
                });

                setIsUploading(false);
                setUploadProgress('');

                if (result.success) {
                    setMessage(result.message || '上傳成功！');
                    setSelectedFiles({ json: null, pdfs: [] });
                    setStartPage(10);
                    setShowAlignmentTool(false);
                    setAlignmentData(null);
                    if (formRef.current) formRef.current.reset();
                    await loadProjects(user.id);
                } else {
                    setMessage(`失敗: ${result.error}`);
                }
            }
        } catch (error) {
            setIsUploading(false);
            setUploadProgress('');
            setMessage(`錯誤: ${error.message}`);
        }
    };

    const handleCancelAlignment = () => {
        setShowAlignmentTool(false);
        setAlignmentData(null);
        setIsUploading(false);
        setUploadProgress('');
    };

    const handleAdjustAlignment = async (projectId, projectName) => {
        // 先診斷專案，取得 PDF URLs 和實際資料內容
        const diagResult = await diagnoseProject(user.id, projectId);
        if (!diagResult.success) {
            alert(`無法載入專案資料: ${diagResult.error}`);
            return;
        }

        const projectData = diagResult.data.project;
        const pageUrlMap = projectData.pdf_urls || {};

        if (Object.keys(pageUrlMap).length === 0) {
            alert('此專案沒有 PDF 資料，無法調整對齊設定');
            return;
        }

        // 取得實際的 source_data（前5筆），包含完整內容
        const sampleData = diagResult.data.sample_data || [];

        // 設定對齊工具資料（調整模式）- 使用實際的資料內容
        setAlignmentData({
            projectId: projectId,
            projectName: projectName,
            jsonData: sampleData.map(item => ({
                data: item.original_data || item.data || '（無資料）',
                page_number: item.page_number
            })),
            pageUrlMap: pageUrlMap,
            isAdjustment: true
        });

        const pdfPages = Object.keys(pageUrlMap).map(Number).sort((a, b) => a - b);
        const minPage = Math.min(...pdfPages);
        const currentStartPage = (projectData.page_offset || 0) + 1;

        setPreviewStartPage(currentStartPage);
        setSelectedPdfPage(minPage);
        setShowAlignmentTool(true);
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
            let jsonData = JSON.parse(jsonText);

            // 按照 page_number 排序 JSON 資料
            jsonData = jsonData.sort((a, b) => {
                const pageA = parseInt(a.page_number) || 0;
                const pageB = parseInt(b.page_number) || 0;
                return pageA - pageB;
            });

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
            
            const projectName = selectedFiles.json.name.replace('esg_annotation_', '').replace('.json', '');

            // 直接儲存到資料庫，使用預設 startPage = 1
            setUploadProgress('儲存資料到資料庫...');
            const result = await saveProjectData(user.id, {
                projectName,
                jsonData,
                pageUrlMap,
                startPage: 1  // 預設從第 1 頁開始，之後可用「調整對齊」修改
            });

            setIsUploading(false);
            setUploadProgress('');

            if (result.success) {
                setMessage(result.message || '上傳成功！請使用「調整對齊」功能設定正確的頁碼對應。');
                setSelectedFiles({ json: null, pdfs: [] });
                if (formRef.current) formRef.current.reset();
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

    // 進度視圖 UI
    if (showProgressView) {
        // 整理資料：按專案分組
        const projectsMap = {};
        allUsersProgress.forEach(row => {
            if (!projectsMap[row.project_name]) {
                projectsMap[row.project_name] = {
                    projectId: row.project_id,
                    projectName: row.project_name,
                    totalTasks: parseInt(row.total_tasks),
                    users: []
                };
            }
            projectsMap[row.project_name].users.push({
                userId: row.user_id,
                username: row.username,
                role: row.role,
                completedTasks: parseInt(row.completed_tasks)
            });
        });

        const projectsList = Object.values(projectsMap);

        return (
            <div className="container">
                <div className="panel" style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h1>📊 所有使用者標註進度</h1>
                        <button
                            className="btn"
                            onClick={() => setShowProgressView(false)}
                            style={{ background: '#6b7280', color: 'white' }}
                        >
                            返回管理頁面
                        </button>
                    </div>
                </div>

                {projectsList.map(project => {
                    // 計算總體進度
                    const totalPossibleAnnotations = project.totalTasks * project.users.length;
                    const totalCompletedAnnotations = project.users.reduce((sum, u) => sum + u.completedTasks, 0);
                    const overallPercentage = project.totalTasks > 0
                        ? ((totalCompletedAnnotations / totalPossibleAnnotations) * 100).toFixed(1)
                        : 0;

                    return (
                        <div key={project.projectId} className="panel" style={{ marginBottom: '20px' }}>
                            <h2>{project.projectName}</h2>
                            <div style={{
                                background: '#f3f4f6',
                                padding: '15px',
                                borderRadius: '8px',
                                marginBottom: '15px'
                            }}>
                                <p style={{ marginBottom: '8px' }}>
                                    <strong>專案總任務數：</strong>{project.totalTasks}
                                </p>
                                <p style={{ marginBottom: '8px' }}>
                                    <strong>總標註進度：</strong>
                                    {totalCompletedAnnotations} / {totalPossibleAnnotations} ({overallPercentage}%)
                                </p>
                                <div style={{
                                    background: '#e5e7eb',
                                    borderRadius: '4px',
                                    height: '20px',
                                    overflow: 'hidden',
                                    marginTop: '10px'
                                }}>
                                    <div style={{
                                        width: `${overallPercentage}%`,
                                        background: '#3b82f6',
                                        height: '100%',
                                        transition: 'width 0.3s'
                                    }}></div>
                                </div>
                            </div>

                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid #ddd', background: '#f9fafb' }}>
                                        <th style={{ textAlign: 'left', padding: '12px' }}>使用者</th>
                                        <th style={{ textAlign: 'left', padding: '12px' }}>角色</th>
                                        <th style={{ textAlign: 'left', padding: '12px' }}>已完成</th>
                                        <th style={{ textAlign: 'left', padding: '12px' }}>總任務</th>
                                        <th style={{ textAlign: 'left', padding: '12px' }}>完成率</th>
                                        <th style={{ textAlign: 'left', padding: '12px', width: '200px' }}>進度條</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {project.users.map(user => {
                                        const percentage = project.totalTasks > 0
                                            ? ((user.completedTasks / project.totalTasks) * 100).toFixed(1)
                                            : 0;
                                        return (
                                            <tr key={user.userId} style={{ borderBottom: '1px solid #eee' }}>
                                                <td style={{ padding: '12px' }}>{user.username}</td>
                                                <td style={{ padding: '12px' }}>
                                                    <span style={{
                                                        padding: '4px 8px',
                                                        borderRadius: '4px',
                                                        fontSize: '12px',
                                                        background: user.role === 'admin' ? '#fef3c7' : '#dbeafe',
                                                        color: user.role === 'admin' ? '#92400e' : '#1e40af'
                                                    }}>
                                                        {user.role}
                                                    </span>
                                                </td>
                                                <td style={{ padding: '12px', fontWeight: 'bold' }}>{user.completedTasks}</td>
                                                <td style={{ padding: '12px' }}>{project.totalTasks}</td>
                                                <td style={{ padding: '12px', fontWeight: 'bold' }}>{percentage}%</td>
                                                <td style={{ padding: '12px' }}>
                                                    <div style={{
                                                        background: '#e5e7eb',
                                                        borderRadius: '4px',
                                                        height: '24px',
                                                        overflow: 'hidden',
                                                        position: 'relative'
                                                    }}>
                                                        <div style={{
                                                            width: `${percentage}%`,
                                                            background: percentage >= 100 ? '#10b981' : '#3b82f6',
                                                            height: '100%',
                                                            transition: 'width 0.3s'
                                                        }}></div>
                                                        <span style={{
                                                            position: 'absolute',
                                                            top: '50%',
                                                            left: '50%',
                                                            transform: 'translate(-50%, -50%)',
                                                            fontSize: '12px',
                                                            fontWeight: 'bold',
                                                            color: '#1f2937'
                                                        }}>
                                                            {percentage}%
                                                        </span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    );
                })}

                {projectsList.length === 0 && (
                    <div className="panel" style={{ textAlign: 'center', padding: '40px' }}>
                        <p style={{ color: '#6b7280' }}>目前沒有專案資料</p>
                    </div>
                )}
            </div>
        );
    }

    // 對齊工具 UI
    if (showAlignmentTool && alignmentData) {
        const pdfPages = Object.keys(alignmentData.pageUrlMap).map(Number).sort((a, b) => a - b);
        const minPdfPage = Math.min(...pdfPages);
        const maxPdfPage = Math.max(...pdfPages);

        // 取得 JSON 前 5 筆資料
        const sampleJsonData = alignmentData.jsonData.slice(0, 5);
        const selectedJson = sampleJsonData[selectedJsonIndex];

        // 計算 PDF 頁碼
        const calculatedPdfPage = (selectedJson?.page_number || 1) + (previewStartPage - 1);
        const pdfUrl = alignmentData.pageUrlMap[selectedPdfPage];

        return (
            <div className="container">
                <div className="panel" style={{ marginBottom: '20px' }}>
                    <h1>🎯 PDF 頁碼對齊工具 {alignmentData.isAdjustment && '（調整模式）'}</h1>
                    <p style={{ color: '#666', marginTop: '10px' }}>
                        專案名稱: <strong>{alignmentData.projectName}</strong>
                    </p>
                    <p style={{ color: '#666' }}>
                        PDF 頁碼範圍: {minPdfPage} ~ {maxPdfPage} (共 {pdfPages.length} 頁)
                    </p>
                    {alignmentData.isAdjustment && (
                        <p style={{ color: '#f59e0b', fontWeight: 'bold', marginTop: '10px' }}>
                            ⚠️ 調整模式：修改對齊設定將重新對應所有資料的 PDF 連結
                        </p>
                    )}
                </div>

                <div className="panel" style={{ background: '#fef3c7', borderLeft: '4px solid #f59e0b', marginBottom: '20px' }}>
                    <h3 style={{ marginBottom: '10px' }}>💡 使用說明</h3>
                    <ol style={{ paddingLeft: '20px', lineHeight: '1.8' }}>
                        <li>左側選擇 JSON 資料（前 5 筆）</li>
                        <li>右側瀏覽 PDF，找到對應的頁面</li>
                        <li>設定「JSON page={selectedJson?.page_number || 1} 對應到 PDF page_{selectedPdfPage}」</li>
                        <li>調整完成後點擊「✅ 確認並儲存」</li>
                    </ol>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                    {/* 左側：JSON 資料選擇 */}
                    <div className="panel">
                        <h2>📄 JSON 資料 (前 5 筆)</h2>
                        <div style={{ marginTop: '10px' }}>
                            {sampleJsonData.map((item, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => setSelectedJsonIndex(idx)}
                                    style={{
                                        padding: '10px',
                                        marginBottom: '10px',
                                        border: selectedJsonIndex === idx ? '2px solid #3b82f6' : '1px solid #ddd',
                                        borderRadius: '4px',
                                        cursor: 'pointer',
                                        background: selectedJsonIndex === idx ? '#eff6ff' : 'white'
                                    }}
                                >
                                    <p style={{ fontSize: '12px', color: '#666', marginBottom: '5px', fontWeight: 'bold' }}>
                                        第 {idx + 1} 筆 (JSON page_number: {item.page_number || 1})
                                    </p>
                                    <div style={{
                                        fontSize: '13px',
                                        lineHeight: '1.4',
                                        maxHeight: '60px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis'
                                    }}>
                                        {item.data?.substring(0, 150)}...
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div style={{
                            marginTop: '15px',
                            padding: '15px',
                            background: '#e0f2fe',
                            borderRadius: '4px',
                            textAlign: 'center'
                        }}>
                            <p style={{ fontSize: '14px', fontWeight: 'bold', marginBottom: '10px' }}>
                                當前設定: JSON page={selectedJson?.page_number || 1} → PDF page_{calculatedPdfPage}
                            </p>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center' }}>
                                <label style={{ fontSize: '13px' }}>報告起始頁:</label>
                                <input
                                    type="number"
                                    value={previewStartPage}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        // 只允許純數字輸入
                                        if (val === '' || /^\d+$/.test(val)) {
                                            setPreviewStartPage(parseInt(val) || 1);
                                        }
                                    }}
                                    onBlur={(e) => {
                                        // 失焦時確保值在範圍內
                                        const val = parseInt(e.target.value);
                                        if (isNaN(val) || val < 1) {
                                            setPreviewStartPage(1);
                                        }
                                    }}
                                    style={{
                                        width: '80px',
                                        padding: '8px',
                                        textAlign: 'center',
                                        border: '2px solid #3b82f6',
                                        borderRadius: '4px',
                                        fontSize: '16px',
                                        fontWeight: 'bold'
                                    }}
                                    min="1"
                                />
                            </div>
                        </div>
                    </div>

                    {/* 右側：PDF 瀏覽器 */}
                    <div className="panel">
                        <h2>📑 PDF 瀏覽器</h2>
                        <div style={{ marginTop: '10px' }}>
                            <div style={{
                                background: '#e0f2fe',
                                padding: '10px',
                                borderRadius: '4px',
                                marginBottom: '10px',
                                textAlign: 'center'
                            }}>
                                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', alignItems: 'center', marginBottom: '10px' }}>
                                    <button
                                        className="btn"
                                        onClick={() => setSelectedPdfPage(prev => Math.max(minPdfPage, prev - 1))}
                                        disabled={selectedPdfPage <= minPdfPage}
                                        style={{ background: '#3b82f6', color: 'white', padding: '8px 16px' }}
                                    >
                                        ← 上一頁
                                    </button>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                        <label style={{ fontSize: '13px' }}>PDF 頁碼:</label>
                                        <input
                                            type="number"
                                            value={selectedPdfPage}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || minPdfPage;
                                                if (val >= minPdfPage && val <= maxPdfPage) {
                                                    setSelectedPdfPage(val);
                                                }
                                            }}
                                            style={{
                                                width: '70px',
                                                padding: '6px',
                                                textAlign: 'center',
                                                border: '1px solid #3b82f6',
                                                borderRadius: '4px',
                                                fontSize: '14px'
                                            }}
                                            min={minPdfPage}
                                            max={maxPdfPage}
                                        />
                                    </div>
                                    <button
                                        className="btn"
                                        onClick={() => setSelectedPdfPage(prev => Math.min(maxPdfPage, prev + 1))}
                                        disabled={selectedPdfPage >= maxPdfPage}
                                        style={{ background: '#3b82f6', color: 'white', padding: '8px 16px' }}
                                    >
                                        下一頁 →
                                    </button>
                                </div>
                                <button
                                    className="btn"
                                    onClick={() => {
                                        const offset = selectedPdfPage - (selectedJson?.page_number || 1);
                                        setPreviewStartPage(offset + 1);
                                    }}
                                    style={{ background: '#10b981', color: 'white', padding: '8px 16px', fontSize: '13px' }}
                                >
                                    ✓ 設定此頁為對應頁
                                </button>
                            </div>

                            {pdfUrl ? (
                                <iframe
                                    src={pdfUrl}
                                    style={{
                                        width: '100%',
                                        height: '600px',
                                        border: '2px solid #ddd',
                                        borderRadius: '4px'
                                    }}
                                />
                            ) : (
                                <div style={{
                                    padding: '40px',
                                    textAlign: 'center',
                                    background: '#fecaca',
                                    borderRadius: '4px',
                                    color: '#b91c1c'
                                }}>
                                    ⚠️ 找不到 page_{selectedPdfPage}.pdf
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* 底部按鈕 */}
                <div className="panel" style={{ textAlign: 'center' }}>
                    <p style={{ marginBottom: '15px', fontSize: '14px', color: '#666' }}>
                        確認設定：JSON 第 1 頁對應到 PDF page_{previewStartPage}
                    </p>
                    <button
                        className="btn btn-success"
                        onClick={handleConfirmAlignment}
                        disabled={isUploading}
                        style={{ marginRight: '10px', fontSize: '16px', padding: '12px 30px' }}
                    >
                        ✅ 確認並儲存 (起始頁 = {previewStartPage})
                    </button>
                    <button
                        className="btn"
                        onClick={handleCancelAlignment}
                        disabled={isUploading}
                        style={{ background: '#6b7280', color: 'white', fontSize: '16px', padding: '12px 30px' }}
                    >
                        ❌ 取消
                    </button>
                    {uploadProgress && (
                        <p style={{ marginTop: '15px', color: '#3b82f6' }}>{uploadProgress}</p>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="container">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px'}}>
                <h1>管理員後台</h1>
                <div>
                    <button
                        className="btn"
                        onClick={async () => {
                            await loadAllUsersProgress();
                            setShowProgressView(true);
                        }}
                        style={{ background: '#3b82f6', color: 'white', marginRight: '10px' }}
                    >
                        📊 查看所有人進度
                    </button>
                    <button className="btn" onClick={() => router.push('/')}>返回標註</button>
                </div>
            </div>

            <div className="panel">
                <h2>上傳新專案</h2>
                <p className="hint">
                    JSON 格式：esg_annotation_專案名.json<br/>
                    PDF 檔名：專案名_page_X.pdf<br/>
                    <strong>📌 上傳後請使用「調整對齊」功能設定正確的頁碼對應</strong>
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
                {isUploading && uploadProgress && (
                    <div style={{
                        padding: '15px',
                        marginBottom: '15px',
                        background: '#eff6ff',
                        border: '1px solid #3b82f6',
                        borderRadius: '4px',
                        color: '#1e40af',
                        fontWeight: 'bold',
                        textAlign: 'center'
                    }}>
                        {uploadProgress}
                    </div>
                )}
                <table style={{width: '100%', borderCollapse: 'collapse'}}>
                    <thead>
                        <tr style={{borderBottom: '1px solid #ddd'}}>
                            <th style={{textAlign: 'left', padding: '8px'}}>專案名稱</th>
                            <th style={{textAlign: 'left', padding: '8px'}}>總任務</th>
                            <th style={{textAlign: 'left', padding: '8px'}}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map(p => (
                            <tr key={p.id} style={{borderBottom: '1px solid #eee'}}>
                                <td style={{padding: '8px'}}>{p.name}</td>
                                <td style={{padding: '8px'}}>{p.total_tasks}</td>
                                <td style={{padding: '8px'}}>
                                    <button
                                        className="btn"
                                        onClick={() => handleAdjustAlignment(p.id, p.name)}
                                        style={{
                                            background: '#f59e0b',
                                            color: 'white',
                                            marginRight: '10px',
                                            fontSize: '12px',
                                            padding: '6px 12px'
                                        }}
                                    >
                                        🎯 調整對齊
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
                                        disabled={isUploading}
                                        style={{
                                            fontSize: '12px',
                                            padding: '6px 12px',
                                            opacity: isUploading ? 0.5 : 1,
                                            cursor: isUploading ? 'not-allowed' : 'pointer'
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