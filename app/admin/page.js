// 檔案路徑: app/admin/page.js
'use client';

import { useState, useEffect, useRef } from 'react';
import { getProjectsWithProgress, getAllUsersProgress } from '../actions';
import {
    deleteProject, deleteProjectOnly, saveProjectData, updateProjectOffset,
    diagnoseProject, exportProjectAnnotations, batchUploadGroupData,
    createProjectGroup, getAllGroups, assignUserToGroup, removeUserFromGroup,
    assignProjectToGroup, getGroupUsers, getAllUsersForAssignment, deleteGroup,
    updateProjectName, createAnnouncement, getAllAnnouncements, updateAnnouncement,
    deleteAnnouncement, toggleAnnouncementStatus
} from '../adminActions';
import { useRouter } from 'next/navigation';
import { upload } from '@vercel/blob/client';
import { PDFDocument } from 'pdf-lib';

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
    const [batchUploadFiles, setBatchUploadFiles] = useState([]);
    const [showBatchResults, setShowBatchResults] = useState(false);
    const [batchResults, setBatchResults] = useState(null);
    const [batchProgress, setBatchProgress] = useState(null);
    // 編輯專案名稱相關狀態
    const [editingProjectId, setEditingProjectId] = useState(null);
    const [editingProjectName, setEditingProjectName] = useState('');
    // 群組管理相關狀態
    const [groups, setGroups] = useState([]);
    const [showGroupManagement, setShowGroupManagement] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupDescription, setNewGroupDescription] = useState('');
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [groupUsers, setGroupUsers] = useState([]);
    const [allUsers, setAllUsers] = useState([]);
    const [isMigrated, setIsMigrated] = useState(false);
    const [isLoadingUsers, setIsLoadingUsers] = useState(false);
    // 公告管理相關狀態
    const [showAnnouncementManagement, setShowAnnouncementManagement] = useState(false);
    const [announcements, setAnnouncements] = useState([]);
    const [announcementForm, setAnnouncementForm] = useState({
        title: '',
        content: '',
        type: 'info',
        isActive: true
    });
    const [editingAnnouncementId, setEditingAnnouncementId] = useState(null);
    const formRef = useRef(null);
    const batchFormRef = useRef(null);
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
        if (window.confirm('確定要完全刪除這個專案嗎？\n\n這將永久移除：\n• 資料庫中的所有資料\n• Vercel Blob 中的所有 PDF 檔案\n• 所有相關的標註記錄\n\n此操作無法復原！')) {
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

    const handleDeleteProjectOnly = async (projectId) => {
        if (window.confirm('確定要刪除專案記錄嗎？\n\n將會保留：\n• ✓ PDF 檔案（Vercel Blob）\n• ✓ 原始資料（source_data）\n• ✓ 標註記錄（annotations）\n\n只會刪除專案記錄，資料可供之後重新導入使用。')) {
            setIsUploading(true);
            setUploadProgress('正在刪除專案記錄...');

            const result = await deleteProjectOnly(user.id, projectId);

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

    const handlePdfChange = (e) => {
        const files = Array.from(e.target.files).filter(f => f.name.endsWith('.pdf'));
        setSelectedFiles(prev => ({ ...prev, pdfs: files }));
        setMessage(`已選擇 ${files.length} 個 PDF 檔案`);
    };

    const handleConfirmAlignment = async () => {
        if (!alignmentData) return;

        // 驗證 previewStartPage 是否為有效整數
        const validatedStartPage = parseInt(previewStartPage, 10);
        if (isNaN(validatedStartPage)) {
            alert('請輸入有效的起始頁碼（必須是整數）');
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
            setMessage('請選擇 PDF 檔案');
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

            // 從 JSON 檔名提取專案名稱
            const projectName = selectedFiles.json.name.replace('esg_annotation_', '').replace('.json', '');

            setUploadProgress(`正在處理 ${selectedFiles.pdfs.length} 個 PDF 檔案...`);
            const pageUrlMap = {};
            let totalPages = 0;

            // 處理每個 PDF：分割並上傳
            const skippedFiles = [];
            for (let pdfIndex = 0; pdfIndex < selectedFiles.pdfs.length; pdfIndex++) {
                const pdfFile = selectedFiles.pdfs[pdfIndex];

                setUploadProgress(`正在分割 PDF ${pdfIndex + 1}/${selectedFiles.pdfs.length}: ${pdfFile.name}`);

                try {
                    // 讀取 PDF
                    const pdfArrayBuffer = await pdfFile.arrayBuffer();
                    const pdfDoc = await PDFDocument.load(pdfArrayBuffer);
                    const pageCount = pdfDoc.getPageCount();

                    // 分割每一頁
                    for (let i = 0; i < pageCount; i++) {
                        const newPdf = await PDFDocument.create();
                        const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
                        newPdf.addPage(copiedPage);

                        const pdfBytes = await newPdf.save();
                        const pageNumber = totalPages + i + 1;
                        const blob = new Blob([pdfBytes], { type: 'application/pdf' });

                        setUploadProgress(`上傳頁面 ${pageNumber}...`);

                        // 上傳單頁 PDF
                        const fileName = `${projectName}_page_${pageNumber}.pdf`;
                        const uploadedBlob = await upload(fileName, blob, {
                            access: 'public',
                            handleUploadUrl: '/api/upload',
                        });

                        pageUrlMap[pageNumber] = uploadedBlob.url;
                    }

                    totalPages += pageCount;
                } catch (pdfError) {
                    console.error(`處理 PDF ${pdfFile.name} 時發生錯誤:`, pdfError);
                    skippedFiles.push(`${pdfFile.name} (${pdfError.message})`);
                    // 繼續處理其他 PDF
                }
            }

            // 儲存到資料庫
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
                let message = `上傳成功！已處理 ${totalPages} 頁 PDF。`;
                if (skippedFiles.length > 0) {
                    message += `\n\n⚠️ 跳過以下無效檔案：\n${skippedFiles.join('\n')}`;
                }
                message += '\n\n請使用「調整對齊」功能設定正確的頁碼對應。';
                setMessage(message);
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

    const handleBatchFolderChange = (event) => {
        const files = Array.from(event.target.files);
        setBatchUploadFiles(files);
    };

    const handleBatchUpload = async (event) => {
        event.preventDefault();
        if (!user) return;

        if (batchUploadFiles.length === 0) {
            setMessage('請選擇包含多組資料的資料夾');
            return;
        }

        setIsUploading(true);
        setMessage('');
        setUploadProgress('準備上傳...');
        setShowBatchResults(false);
        setBatchProgress({ current: 0, total: 0, projectName: '', currentPage: 0, totalPages: 0 });

        try {
            const formData = new FormData();
            formData.append('userId', user.id);
            batchUploadFiles.forEach(file => {
                formData.append('files', file);
            });

            const response = await fetch('/api/batch-upload', {
                method: 'POST',
                body: formData,
            });

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            const details = [];

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = JSON.parse(line.slice(6));

                        switch (data.type) {
                            case 'start':
                                setBatchProgress({
                                    current: 0,
                                    total: data.totalProjects,
                                    projectName: '',
                                    currentPage: 0,
                                    totalPages: 0
                                });
                                setUploadProgress(data.message);
                                break;

                            case 'progress':
                                setBatchProgress(prev => ({
                                    ...prev,
                                    current: data.current,
                                    total: data.total,
                                    projectName: data.projectName
                                }));
                                setUploadProgress(data.message);
                                break;

                            case 'processing-pdf':
                                setUploadProgress(`${data.projectName}: ${data.message}`);
                                break;

                            case 'uploading-page':
                                setBatchProgress(prev => ({
                                    ...prev,
                                    currentPage: data.currentPage,
                                    totalPages: data.totalPages
                                }));
                                setUploadProgress(`${data.projectName}: ${data.message}`);
                                break;

                            case 'saving-database':
                                setUploadProgress(`${data.projectName}: ${data.message}`);
                                break;

                            case 'project-success':
                                details.push({ projectName: data.projectName, success: true, message: data.message });
                                break;

                            case 'project-failed':
                                details.push({ projectName: data.projectName, success: false, error: data.error });
                                break;

                            case 'complete':
                                setBatchResults({
                                    success: true,
                                    totalProjects: data.totalProjects,
                                    successProjects: data.successProjects,
                                    failedProjects: data.failedProjects,
                                    details: data.details
                                });
                                setShowBatchResults(true);
                                setBatchUploadFiles([]);
                                if (batchFormRef.current) batchFormRef.current.reset();
                                await loadProjects(user.id);
                                break;

                            case 'error':
                                setMessage(`錯誤: ${data.message}`);
                                break;
                        }
                    }
                }
            }

            setIsUploading(false);
            setUploadProgress('');
            setBatchProgress(null);

        } catch (error) {
            setIsUploading(false);
            setUploadProgress('');
            setBatchProgress(null);
            setMessage(`錯誤: ${error.message}`);
            console.error('Batch upload error:', error);
        }
    };

    // ========== 群組管理功能 ==========

    const handleRunMigration = async () => {
        if (!confirm('確定要執行資料庫遷移嗎？\n這將建立專案群組和權限相關的資料表。')) return;

        setIsUploading(true);
        setUploadProgress('正在執行資料庫遷移...');

        try {
            const response = await fetch('/api/migrate-groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id })
            });

            const result = await response.json();

            if (result.success) {
                alert(result.message);
                setIsMigrated(true);
                await loadGroups();
            } else {
                alert(`遷移失敗: ${result.error}`);
            }
        } catch (error) {
            alert(`遷移失敗: ${error.message}`);
        } finally {
            setIsUploading(false);
            setUploadProgress('');
        }
    };

    const loadGroups = async () => {
        try {
            const result = await getAllGroups(user.id);
            if (result.success) {
                setGroups(result.groups);
                setIsMigrated(true);
            }
        } catch (error) {
            console.error('載入群組失敗:', error);
        }
    };

    const loadAllUsersForGroup = async () => {
        setIsLoadingUsers(true);
        try {
            const result = await getAllUsersForAssignment(user.id);
            console.log('getAllUsersForAssignment result:', result);
            if (result.success) {
                setAllUsers(result.users);
                console.log('載入使用者成功:', result.users);
            } else {
                console.error('載入使用者失敗:', result.error);
                alert(`載入使用者失敗: ${result.error}`);
                setAllUsers([]);
            }
        } catch (error) {
            console.error('載入使用者發生錯誤:', error);
            alert(`載入使用者發生錯誤: ${error.message}`);
            setAllUsers([]);
        } finally {
            setIsLoadingUsers(false);
        }
    };

    const handleCreateGroup = async (e) => {
        e.preventDefault();
        if (!newGroupName.trim()) return;

        const result = await createProjectGroup(user.id, newGroupName, newGroupDescription);
        if (result.success) {
            alert(result.message);
            setNewGroupName('');
            setNewGroupDescription('');
            await loadGroups();
        } else {
            alert(`建立失敗: ${result.error}`);
        }
    };

    const handleSelectGroup = async (group) => {
        setSelectedGroup(group);
        const result = await getGroupUsers(user.id, group.id);
        if (result.success) {
            setGroupUsers(result.users);
        }
        await loadAllUsersForGroup();
    };

    const handleAssignUser = async (groupId, userId) => {
        const result = await assignUserToGroup(user.id, userId, groupId);
        if (result.success) {
            alert(result.message);
            await handleSelectGroup(selectedGroup);
        } else {
            alert(`分配失敗: ${result.error}`);
        }
    };

    const handleRemoveUser = async (groupId, userId) => {
        if (!confirm('確定要從群組移除此使用者嗎？')) return;
        const result = await removeUserFromGroup(user.id, userId, groupId);
        if (result.success) {
            alert(result.message);
            await handleSelectGroup(selectedGroup);
        } else {
            alert(`移除失敗: ${result.error}`);
        }
    };

    const handleAssignProjectToGroup = async (projectId, groupId) => {
        const result = await assignProjectToGroup(user.id, projectId, groupId);
        if (result.success) {
            alert(result.message);
            await loadProjects(user.id);
            await loadGroups();
        } else {
            alert(`分配失敗: ${result.error}`);
        }
    };

    const handleDeleteGroup = async (groupId) => {
        if (!confirm('確定要刪除此群組嗎？\n群組中的專案將變為無群組狀態。')) return;
        const result = await deleteGroup(user.id, groupId);
        if (result.success) {
            alert(result.message);
            setSelectedGroup(null);
            await loadGroups();
            await loadProjects(user.id);
        } else {
            alert(`刪除失敗: ${result.error}`);
        }
    };

    const handleStartEditProjectName = (projectId, currentName) => {
        setEditingProjectId(projectId);
        setEditingProjectName(currentName);
    };

    const handleCancelEditProjectName = () => {
        setEditingProjectId(null);
        setEditingProjectName('');
    };

    const handleSaveProjectName = async (projectId) => {
        if (!editingProjectName.trim()) {
            alert('專案名稱不能為空');
            return;
        }

        const result = await updateProjectName(user.id, projectId, editingProjectName);
        if (result.success) {
            alert(result.message);
            setEditingProjectId(null);
            setEditingProjectName('');
            await loadProjects(user.id);
        } else {
            alert(`更新失敗: ${result.error}`);
        }
    };

    // ============ 公告管理函數 ============
    const loadAnnouncements = async () => {
        const result = await getAllAnnouncements(user.id);
        if (result.success) {
            setAnnouncements(result.announcements);
        } else {
            alert(`載入公告失敗: ${result.error}`);
        }
    };

    const handleAnnouncementSubmit = async (e) => {
        e.preventDefault();

        if (!announcementForm.title.trim() || !announcementForm.content.trim()) {
            alert('標題和內容不能為空');
            return;
        }

        const result = editingAnnouncementId
            ? await updateAnnouncement(user.id, editingAnnouncementId, announcementForm)
            : await createAnnouncement(user.id, announcementForm);

        if (result.success) {
            alert(result.message);
            setAnnouncementForm({ title: '', content: '', type: 'info', isActive: true });
            setEditingAnnouncementId(null);
            await loadAnnouncements();
        } else {
            alert(`操作失敗: ${result.error}`);
        }
    };

    const handleEditAnnouncement = (announcement) => {
        setEditingAnnouncementId(announcement.id);
        setAnnouncementForm({
            title: announcement.title,
            content: announcement.content,
            type: announcement.type,
            isActive: announcement.is_active
        });
    };

    const handleDeleteAnnouncement = async (announcementId) => {
        if (!confirm('確定要刪除這則公告嗎？')) return;

        const result = await deleteAnnouncement(user.id, announcementId);
        if (result.success) {
            alert(result.message);
            await loadAnnouncements();
        } else {
            alert(`刪除失敗: ${result.error}`);
        }
    };

    const handleToggleAnnouncementStatus = async (announcementId) => {
        const result = await toggleAnnouncementStatus(user.id, announcementId);
        if (result.success) {
            await loadAnnouncements();
        } else {
            alert(`切換狀態失敗: ${result.error}`);
        }
    };

    if (!user) return <div className="container"><h1>驗證中...</h1></div>;

    // 進度視圖 UI
    if (showProgressView) {
        // 整理資料：按群組分組
        const groupsMap = {};
        allUsersProgress.forEach(row => {
            const groupKey = row.group_name || '未分組';

            if (!groupsMap[groupKey]) {
                groupsMap[groupKey] = {
                    groupId: row.group_id,
                    groupName: groupKey,
                    projects: {}
                };
            }

            if (!groupsMap[groupKey].projects[row.project_name]) {
                groupsMap[groupKey].projects[row.project_name] = {
                    projectId: row.project_id,
                    projectName: row.project_name,
                    totalTasks: parseInt(row.total_tasks),
                    users: []
                };
            }

            groupsMap[groupKey].projects[row.project_name].users.push({
                userId: row.user_id,
                username: row.username,
                role: row.role,
                completedTasks: parseInt(row.completed_tasks)
            });
        });

        const groupsList = Object.values(groupsMap).map(group => ({
            ...group,
            projects: Object.values(group.projects)
        }));

        return (
            <div className="container">
                <div className="panel" style={{ marginBottom: '20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h1>📊 組別標註進度</h1>
                        <button
                            className="btn"
                            onClick={() => setShowProgressView(false)}
                            style={{ background: '#6b7280', color: 'white' }}
                        >
                            返回管理頁面
                        </button>
                    </div>
                </div>

                {groupsList.map((group, groupIdx) => {
                    // 計算群組總體進度
                    let groupTotalTasks = 0;
                    let groupTotalCompleted = 0;

                    group.projects.forEach(project => {
                        const projectTotal = project.totalTasks * project.users.length;
                        const projectCompleted = project.users.reduce((sum, u) => sum + u.completedTasks, 0);
                        groupTotalTasks += projectTotal;
                        groupTotalCompleted += projectCompleted;
                    });

                    const groupPercentage = groupTotalTasks > 0
                        ? ((groupTotalCompleted / groupTotalTasks) * 100).toFixed(1)
                        : 0;

                    return (
                        <div key={groupIdx} className="panel" style={{ marginBottom: '30px', background: '#fafafa' }}>
                            <div style={{
                                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                                padding: '20px',
                                borderRadius: '8px 8px 0 0',
                                marginBottom: '20px',
                                color: 'white'
                            }}>
                                <h2 style={{ margin: '0 0 10px 0', color: 'white' }}>🔐 {group.groupName}</h2>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <p style={{ margin: '5px 0', fontSize: '14px' }}>
                                            專案數：{group.projects.length}
                                        </p>
                                        <p style={{ margin: '5px 0', fontSize: '14px' }}>
                                            總進度：{groupTotalCompleted} / {groupTotalTasks} ({groupPercentage}%)
                                        </p>
                                    </div>
                                    <div style={{
                                        width: '200px',
                                        background: 'rgba(255,255,255,0.3)',
                                        borderRadius: '12px',
                                        height: '24px',
                                        overflow: 'hidden'
                                    }}>
                                        <div style={{
                                            width: `${groupPercentage}%`,
                                            background: 'white',
                                            height: '100%',
                                            transition: 'width 0.3s',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '12px',
                                            fontWeight: 'bold',
                                            color: '#667eea'
                                        }}>
                                            {groupPercentage}%
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {group.projects.map(project => {
                                // 計算專案進度
                                const totalPossibleAnnotations = project.totalTasks * project.users.length;
                                const totalCompletedAnnotations = project.users.reduce((sum, u) => sum + u.completedTasks, 0);
                                const overallPercentage = project.totalTasks > 0
                                    ? ((totalCompletedAnnotations / totalPossibleAnnotations) * 100).toFixed(1)
                                    : 0;

                                return (
                                    <div key={project.projectId} style={{ marginBottom: '20px', background: 'white', padding: '15px', borderRadius: '8px' }}>
                                        <h3 style={{ marginBottom: '15px', color: '#374151' }}>📁 {project.projectName}</h3>
                                        <div style={{
                                            background: '#f3f4f6',
                                            padding: '12px',
                                            borderRadius: '6px',
                                            marginBottom: '15px'
                                        }}>
                                            <p style={{ marginBottom: '5px', fontSize: '13px' }}>
                                                <strong>專案總任務數：</strong>{project.totalTasks}
                                            </p>
                                            <p style={{ marginBottom: '8px', fontSize: '13px' }}>
                                                <strong>標註進度：</strong>
                                                {totalCompletedAnnotations} / {totalPossibleAnnotations} ({overallPercentage}%)
                                            </p>
                                            <div style={{
                                                background: '#e5e7eb',
                                                borderRadius: '4px',
                                                height: '16px',
                                                overflow: 'hidden'
                                            }}>
                                                <div style={{
                                                    width: `${overallPercentage}%`,
                                                    background: '#8b5cf6',
                                                    height: '100%',
                                                    transition: 'width 0.3s'
                                                }}></div>
                                            </div>
                                        </div>

                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '2px solid #ddd', background: '#f9fafb' }}>
                                                    <th style={{ textAlign: 'left', padding: '10px' }}>使用者</th>
                                                    <th style={{ textAlign: 'left', padding: '10px' }}>角色</th>
                                                    <th style={{ textAlign: 'left', padding: '10px' }}>已完成</th>
                                                    <th style={{ textAlign: 'left', padding: '10px' }}>總任務</th>
                                                    <th style={{ textAlign: 'left', padding: '10px' }}>完成率</th>
                                                    <th style={{ textAlign: 'left', padding: '10px', width: '180px' }}>進度條</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {project.users.map(user => {
                                                    const percentage = project.totalTasks > 0
                                                        ? ((user.completedTasks / project.totalTasks) * 100).toFixed(1)
                                                        : 0;
                                                    return (
                                                        <tr key={user.userId} style={{ borderBottom: '1px solid #eee' }}>
                                                            <td style={{ padding: '10px' }}>{user.username}</td>
                                                            <td style={{ padding: '10px' }}>
                                                                <span style={{
                                                                    padding: '3px 6px',
                                                                    borderRadius: '3px',
                                                                    fontSize: '11px',
                                                                    background: user.role === 'admin' ? '#fef3c7' : '#dbeafe',
                                                                    color: user.role === 'admin' ? '#92400e' : '#1e40af'
                                                                }}>
                                                                    {user.role}
                                                                </span>
                                                            </td>
                                                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{user.completedTasks}</td>
                                                            <td style={{ padding: '10px' }}>{project.totalTasks}</td>
                                                            <td style={{ padding: '10px', fontWeight: 'bold' }}>{percentage}%</td>
                                                            <td style={{ padding: '10px' }}>
                                                                <div style={{
                                                                    background: '#e5e7eb',
                                                                    borderRadius: '4px',
                                                                    height: '20px',
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
                                                                        fontSize: '11px',
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
                        </div>
                    );
                })}

                {groupsList.length === 0 && (
                    <div className="panel" style={{ textAlign: 'center', padding: '40px' }}>
                        <p style={{ color: '#6b7280' }}>目前沒有資料</p>
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
                                        // 允許負號、數字和空字串
                                        if (val === '' || val === '-' || /^-?\d+$/.test(val)) {
                                            setPreviewStartPage(val === '' || val === '-' ? val : parseInt(val));
                                        }
                                    }}
                                    onBlur={(e) => {
                                        // 失焦時確保值是有效數字
                                        const val = e.target.value;
                                        if (val === '' || val === '-') {
                                            setPreviewStartPage(0);
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
                            setShowAnnouncementManagement(!showAnnouncementManagement);
                            if (!showAnnouncementManagement) {
                                await loadAnnouncements();
                            }
                        }}
                        style={{ background: '#10b981', color: 'white', marginRight: '10px' }}
                    >
                        📢 {showAnnouncementManagement ? '關閉' : '開啟'}公告管理
                    </button>
                    <button
                        className="btn"
                        onClick={async () => {
                            setShowGroupManagement(!showGroupManagement);
                            if (!showGroupManagement) {
                                await loadGroups();
                            }
                        }}
                        style={{ background: '#8b5cf6', color: 'white', marginRight: '10px' }}
                    >
                        🔐 {showGroupManagement ? '關閉' : '開啟'}群組管理
                    </button>
                    <button
                        className="btn"
                        onClick={async () => {
                            await loadAllUsersProgress();
                            setShowProgressView(true);
                        }}
                        style={{ background: '#3b82f6', color: 'white', marginRight: '10px' }}
                    >
                        📊 查看組別進度
                    </button>
                    <button className="btn" onClick={() => router.push('/')}>返回標註</button>
                </div>
            </div>

            {/* 公告管理區塊 */}
            {showAnnouncementManagement && (
                <div className="panel" style={{marginBottom: '20px', background: '#f0fdf4', borderLeft: '4px solid #10b981'}}>
                    <h2>📢 公告管理</h2>

                    {/* 新增/編輯公告表單 */}
                    <div style={{marginBottom: '30px', padding: '15px', background: 'white', borderRadius: '8px'}}>
                        <h3 style={{marginBottom: '15px'}}>
                            {editingAnnouncementId ? '編輯公告' : '新增公告'}
                        </h3>
                        <form onSubmit={handleAnnouncementSubmit}>
                            <div style={{display: 'grid', gap: '15px', marginBottom: '15px'}}>
                                <div>
                                    <label style={{display: 'block', marginBottom: '5px', fontSize: '14px'}}>標題 *</label>
                                    <input
                                        type="text"
                                        value={announcementForm.title}
                                        onChange={(e) => setAnnouncementForm({...announcementForm, title: e.target.value})}
                                        required
                                        placeholder="輸入公告標題..."
                                        style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db'}}
                                    />
                                </div>
                                <div>
                                    <label style={{display: 'block', marginBottom: '5px', fontSize: '14px'}}>內容 *</label>
                                    <textarea
                                        value={announcementForm.content}
                                        onChange={(e) => setAnnouncementForm({...announcementForm, content: e.target.value})}
                                        required
                                        placeholder="輸入公告內容..."
                                        rows={4}
                                        style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db'}}
                                    />
                                </div>
                                <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px'}}>
                                    <div>
                                        <label style={{display: 'block', marginBottom: '5px', fontSize: '14px'}}>類型</label>
                                        <select
                                            value={announcementForm.type}
                                            onChange={(e) => setAnnouncementForm({...announcementForm, type: e.target.value})}
                                            style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db'}}
                                        >
                                            <option value="info">一般訊息 (藍色)</option>
                                            <option value="warning">警告 (橘色)</option>
                                            <option value="success">成功 (綠色)</option>
                                            <option value="error">錯誤 (紅色)</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label style={{display: 'block', marginBottom: '5px', fontSize: '14px'}}>狀態</label>
                                        <select
                                            value={announcementForm.isActive ? 'true' : 'false'}
                                            onChange={(e) => setAnnouncementForm({...announcementForm, isActive: e.target.value === 'true'})}
                                            style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db'}}
                                        >
                                            <option value="true">顯示</option>
                                            <option value="false">隱藏</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div style={{display: 'flex', gap: '10px'}}>
                                <button type="submit" className="btn" style={{background: '#10b981', color: 'white'}}>
                                    {editingAnnouncementId ? '✓ 更新公告' : '➕ 新增公告'}
                                </button>
                                {editingAnnouncementId && (
                                    <button
                                        type="button"
                                        className="btn"
                                        onClick={() => {
                                            setEditingAnnouncementId(null);
                                            setAnnouncementForm({ title: '', content: '', type: 'info', isActive: true });
                                        }}
                                        style={{background: '#6b7280', color: 'white'}}
                                    >
                                        取消編輯
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>

                    {/* 公告列表 */}
                    <div style={{padding: '15px', background: 'white', borderRadius: '8px'}}>
                        <h3 style={{marginBottom: '15px'}}>現有公告</h3>
                        {announcements.length === 0 ? (
                            <p style={{color: '#6b7280', textAlign: 'center', padding: '20px'}}>尚無公告</p>
                        ) : (
                            <div style={{display: 'grid', gap: '15px'}}>
                                {announcements.map(announcement => {
                                    const typeColors = {
                                        info: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
                                        warning: { bg: '#fed7aa', border: '#f59e0b', text: '#92400e' },
                                        success: { bg: '#d1fae5', border: '#10b981', text: '#065f46' },
                                        error: { bg: '#fecaca', border: '#ef4444', text: '#991b1b' }
                                    };
                                    const colors = typeColors[announcement.type] || typeColors.info;

                                    return (
                                        <div
                                            key={announcement.id}
                                            style={{
                                                padding: '15px',
                                                background: colors.bg,
                                                border: `2px solid ${colors.border}`,
                                                borderRadius: '8px',
                                                opacity: announcement.is_active ? 1 : 0.5
                                            }}
                                        >
                                            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '10px'}}>
                                                <div style={{flex: 1}}>
                                                    <h4 style={{margin: 0, marginBottom: '5px', color: colors.text}}>
                                                        {announcement.title}
                                                        {!announcement.is_active && <span style={{marginLeft: '10px', fontSize: '12px'}}>(隱藏中)</span>}
                                                    </h4>
                                                    <p style={{margin: 0, fontSize: '14px', color: colors.text, whiteSpace: 'pre-wrap'}}>
                                                        {announcement.content}
                                                    </p>
                                                    <p style={{margin: 0, marginTop: '8px', fontSize: '12px', color: '#6b7280'}}>
                                                        建立者: {announcement.created_by_username || '未知'} |
                                                        建立時間: {new Date(announcement.created_at).toLocaleString('zh-TW')}
                                                    </p>
                                                </div>
                                                <div style={{display: 'flex', gap: '8px', marginLeft: '15px'}}>
                                                    <button
                                                        className="btn"
                                                        onClick={() => handleToggleAnnouncementStatus(announcement.id)}
                                                        style={{
                                                            padding: '5px 10px',
                                                            fontSize: '12px',
                                                            background: announcement.is_active ? '#f59e0b' : '#10b981',
                                                            color: 'white'
                                                        }}
                                                        title={announcement.is_active ? '隱藏公告' : '顯示公告'}
                                                    >
                                                        {announcement.is_active ? '👁️ 隱藏' : '👁️ 顯示'}
                                                    </button>
                                                    <button
                                                        className="btn"
                                                        onClick={() => handleEditAnnouncement(announcement)}
                                                        style={{
                                                            padding: '5px 10px',
                                                            fontSize: '12px',
                                                            background: '#3b82f6',
                                                            color: 'white'
                                                        }}
                                                    >
                                                        ✏️ 編輯
                                                    </button>
                                                    <button
                                                        className="btn"
                                                        onClick={() => handleDeleteAnnouncement(announcement.id)}
                                                        style={{
                                                            padding: '5px 10px',
                                                            fontSize: '12px',
                                                            background: '#ef4444',
                                                            color: 'white'
                                                        }}
                                                    >
                                                        🗑️ 刪除
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 群組管理區塊 */}
            {showGroupManagement && (
                <div className="panel" style={{marginBottom: '20px', background: '#faf5ff', borderLeft: '4px solid #8b5cf6'}}>
                    <h2>🔐 專案群組管理</h2>

                    {/* 資料庫遷移按鈕 */}
                    {!isMigrated && (
                        <div style={{
                            padding: '15px',
                            marginBottom: '20px',
                            background: '#fff7ed',
                            border: '2px solid #f59e0b',
                            borderRadius: '8px'
                        }}>
                            <p style={{marginBottom: '10px', color: '#92400e'}}>
                                <strong>⚠️ 首次使用需要執行資料庫遷移</strong>
                            </p>
                            <p style={{marginBottom: '15px', fontSize: '14px', color: '#92400e'}}>
                                這將建立專案群組和使用者權限相關的資料表
                            </p>
                            <button
                                className="btn"
                                onClick={handleRunMigration}
                                disabled={isUploading}
                                style={{background: '#f59e0b', color: 'white'}}
                            >
                                執行資料庫遷移
                            </button>
                        </div>
                    )}

                    {isMigrated && (
                        <>
                            {/* 建立新群組 */}
                            <div style={{marginBottom: '30px', padding: '15px', background: 'white', borderRadius: '8px'}}>
                                <h3 style={{marginBottom: '15px'}}>建立新群組</h3>
                                <form onSubmit={handleCreateGroup}>
                                    <div style={{display: 'grid', gap: '10px', marginBottom: '15px'}}>
                                        <div>
                                            <label style={{display: 'block', marginBottom: '5px', fontSize: '14px'}}>群組名稱 *</label>
                                            <input
                                                type="text"
                                                value={newGroupName}
                                                onChange={(e) => setNewGroupName(e.target.value)}
                                                required
                                                style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db'}}
                                            />
                                        </div>
                                        <div>
                                            <label style={{display: 'block', marginBottom: '5px', fontSize: '14px'}}>描述</label>
                                            <textarea
                                                value={newGroupDescription}
                                                onChange={(e) => setNewGroupDescription(e.target.value)}
                                                rows={2}
                                                style={{width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d1d5db'}}
                                            />
                                        </div>
                                    </div>
                                    <button type="submit" className="btn" style={{background: '#8b5cf6', color: 'white'}}>
                                        ➕ 建立群組
                                    </button>
                                </form>
                            </div>

                            {/* 群組列表和管理 */}
                            <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px'}}>
                                {/* 左側：群組列表 */}
                                <div style={{padding: '15px', background: 'white', borderRadius: '8px'}}>
                                    <h3 style={{marginBottom: '15px'}}>群組列表</h3>
                                    {groups.length === 0 ? (
                                        <p style={{color: '#6b7280', fontSize: '14px'}}>尚無群組</p>
                                    ) : (
                                        <div style={{display: 'flex', flexDirection: 'column', gap: '10px'}}>
                                            {groups.map(group => (
                                                <div
                                                    key={group.id}
                                                    style={{
                                                        padding: '12px',
                                                        border: selectedGroup?.id === group.id ? '2px solid #8b5cf6' : '1px solid #e5e7eb',
                                                        borderRadius: '6px',
                                                        cursor: 'pointer',
                                                        background: selectedGroup?.id === group.id ? '#f3e8ff' : 'white',
                                                        transition: 'all 0.2s'
                                                    }}
                                                    onClick={() => handleSelectGroup(group)}
                                                >
                                                    <div style={{fontWeight: 'bold', marginBottom: '5px'}}>{group.name}</div>
                                                    {group.description && (
                                                        <div style={{fontSize: '13px', color: '#6b7280', marginBottom: '8px'}}>
                                                            {group.description}
                                                        </div>
                                                    )}
                                                    <div style={{fontSize: '12px', color: '#9ca3af'}}>
                                                        👥 {group.user_count} 使用者 | 📁 {group.project_count} 專案
                                                    </div>
                                                    {selectedGroup?.id === group.id && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteGroup(group.id);
                                                            }}
                                                            style={{
                                                                marginTop: '10px',
                                                                padding: '4px 8px',
                                                                background: '#ef4444',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                fontSize: '12px',
                                                                cursor: 'pointer'
                                                            }}
                                                        >
                                                            🗑️ 刪除群組
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 右側：群組使用者管理 */}
                                <div style={{padding: '15px', background: 'white', borderRadius: '8px'}}>
                                    <h3 style={{marginBottom: '15px'}}>
                                        {selectedGroup ? `管理「${selectedGroup.name}」的使用者` : '請選擇群組'}
                                    </h3>
                                    {selectedGroup ? (
                                        <>
                                            {/* 已分配的使用者 */}
                                            <div style={{marginBottom: '20px'}}>
                                                <h4 style={{fontSize: '14px', marginBottom: '10px', color: '#374151'}}>已分配使用者</h4>
                                                {groupUsers.length === 0 ? (
                                                    <p style={{fontSize: '13px', color: '#9ca3af'}}>尚無使用者</p>
                                                ) : (
                                                    <div style={{display: 'flex', flexDirection: 'column', gap: '6px'}}>
                                                        {groupUsers.map(user => (
                                                            <div
                                                                key={user.id}
                                                                style={{
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    alignItems: 'center',
                                                                    padding: '8px',
                                                                    background: '#f9fafb',
                                                                    borderRadius: '4px',
                                                                    fontSize: '13px'
                                                                }}
                                                            >
                                                                <span>
                                                                    {user.username}
                                                                    <span style={{color: '#9ca3af', marginLeft: '8px', fontSize: '11px'}}>
                                                                        ({user.role})
                                                                    </span>
                                                                </span>
                                                                <button
                                                                    onClick={() => handleRemoveUser(selectedGroup.id, user.id)}
                                                                    style={{
                                                                        padding: '2px 6px',
                                                                        background: '#ef4444',
                                                                        color: 'white',
                                                                        border: 'none',
                                                                        borderRadius: '3px',
                                                                        fontSize: '11px',
                                                                        cursor: 'pointer'
                                                                    }}
                                                                >
                                                                    移除
                                                                </button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* 新增使用者 */}
                                            <div>
                                                <h4 style={{fontSize: '14px', marginBottom: '10px', color: '#374151'}}>新增使用者</h4>
                                                {isLoadingUsers ? (
                                                    <p style={{fontSize: '13px', color: '#9ca3af'}}>載入中...</p>
                                                ) : allUsers.length === 0 ? (
                                                    <p style={{fontSize: '13px', color: '#ef4444'}}>無法載入使用者列表</p>
                                                ) : allUsers.filter(u => !groupUsers.find(gu => gu.id === u.id)).length === 0 ? (
                                                    <p style={{fontSize: '13px', color: '#9ca3af'}}>所有使用者都已加入此群組</p>
                                                ) : (
                                                    <div style={{display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '200px', overflow: 'auto'}}>
                                                        {allUsers
                                                            .filter(u => !groupUsers.find(gu => gu.id === u.id))
                                                            .map(user => (
                                                                <div
                                                                    key={user.id}
                                                                    style={{
                                                                        display: 'flex',
                                                                        justifyContent: 'space-between',
                                                                        alignItems: 'center',
                                                                        padding: '8px',
                                                                        background: '#f9fafb',
                                                                        borderRadius: '4px',
                                                                        fontSize: '13px'
                                                                    }}
                                                                >
                                                                    <span>
                                                                        {user.username}
                                                                        <span style={{
                                                                            color: '#9ca3af',
                                                                            marginLeft: '8px',
                                                                            fontSize: '11px'
                                                                        }}>
                                                                            ({user.role})
                                                                        </span>
                                                                    </span>
                                                                    <button
                                                                        onClick={() => handleAssignUser(selectedGroup.id, user.id)}
                                                                        style={{
                                                                            padding: '2px 6px',
                                                                            background: '#10b981',
                                                                            color: 'white',
                                                                            border: 'none',
                                                                            borderRadius: '3px',
                                                                            fontSize: '11px',
                                                                            cursor: 'pointer'
                                                                        }}
                                                                    >
                                                                        ➕ 新增
                                                                    </button>
                                                                </div>
                                                            ))}
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <p style={{fontSize: '13px', color: '#9ca3af'}}>請從左側選擇一個群組來管理使用者</p>
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            <div className="panel">
                <h2>上傳新專案（支援完整 PDF 自動分頁）</h2>
                <p className="hint">
                    <strong>📄 JSON 格式：</strong>esg_annotation_專案名.json<br/>
                    <strong>📑 PDF 檔案：</strong>選擇完整 PDF（系統會自動分割成單頁並上傳）<br/>
                    <strong>📌 提示：</strong>上傳後請使用「調整對齊」功能設定正確的頁碼對應
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
                        <label>PDF 檔案（支援多選，會自動分頁）</label>
                        <input
                            type="file"
                            accept=".pdf"
                            multiple
                            onChange={handlePdfChange}
                            required
                            disabled={isUploading}
                        />
                        {selectedFiles.pdfs.length > 0 && (
                            <p className="hint" style={{marginTop: '5px', color: 'green'}}>
                                ✓ {selectedFiles.pdfs.length} 個 PDF 檔案（將自動分割成單頁）
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

            <div className="panel" style={{marginTop: '20px', background: '#f0fdf4', borderLeft: '4px solid #10b981'}}>
                <h2>📦 批次上傳組別資料（含 PDF 自動分頁）</h2>
                <p className="hint" style={{marginBottom: '10px'}}>
                    <strong>資料夾結構：</strong><br/>
                    根資料夾/<br/>
                    　├─ 組別1/<br/>
                    　│　├─ 公司A/ (內含 .json 和 .pdf)<br/>
                    　│　└─ 公司B/ (內含 .json 和 .pdf)<br/>
                    　├─ 組別2/<br/>
                    　│　└─ 公司C/ (內含 .json 和 .pdf)<br/>
                    　└─ ...<br/>
                    <br/>
                    <strong>功能說明：</strong><br/>
                    • 自動將 PDF 分割成單頁並上傳<br/>
                    • 專案名稱格式：組別名稱_公司名稱<br/>
                    • 自動建立頁碼對應關係<br/>
                    • 支援多個 PDF 檔案（會合併所有頁面）
                </p>
                <form ref={batchFormRef} onSubmit={handleBatchUpload} style={{ marginTop: '15px' }}>
                    <div className="field">
                        <label>選擇根資料夾（包含多個組別）</label>
                        <input
                            type="file"
                            webkitdirectory="true"
                            directory="true"
                            multiple
                            onChange={handleBatchFolderChange}
                            required
                            disabled={isUploading}
                        />
                        {batchUploadFiles.length > 0 && (
                            <p className="hint" style={{marginTop: '5px', color: 'green'}}>
                                ✓ 已選擇 {batchUploadFiles.length} 個檔案
                            </p>
                        )}
                    </div>

                    <button type="submit" className="btn" style={{background: '#10b981', color: 'white'}} disabled={isUploading}>
                        {isUploading ? '批次上傳中...' : '🚀 開始批次上傳'}
                    </button>
                </form>

                {isUploading && batchProgress && batchProgress.total > 0 && (
                    <div style={{
                        marginTop: '20px',
                        padding: '20px',
                        background: 'white',
                        borderRadius: '8px',
                        border: '2px solid #10b981'
                    }}>
                        <h3 style={{marginBottom: '15px', color: '#10b981'}}>⏳ 上傳進度</h3>

                        {/* 整體專案進度 */}
                        <div style={{marginBottom: '20px'}}>
                            <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px'}}>
                                <span style={{fontWeight: 'bold'}}>專案進度</span>
                                <span style={{color: '#10b981', fontWeight: 'bold'}}>
                                    {batchProgress.current} / {batchProgress.total}
                                </span>
                            </div>
                            <div style={{
                                width: '100%',
                                height: '30px',
                                background: '#e5e7eb',
                                borderRadius: '15px',
                                overflow: 'hidden',
                                position: 'relative'
                            }}>
                                <div style={{
                                    width: `${(batchProgress.current / batchProgress.total) * 100}%`,
                                    height: '100%',
                                    background: 'linear-gradient(90deg, #10b981, #059669)',
                                    transition: 'width 0.3s ease',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    color: 'white',
                                    fontWeight: 'bold',
                                    fontSize: '14px'
                                }}>
                                    {Math.round((batchProgress.current / batchProgress.total) * 100)}%
                                </div>
                            </div>
                        </div>

                        {/* 當前專案資訊 */}
                        {batchProgress.projectName && (
                            <div style={{
                                padding: '12px',
                                background: '#f0fdf4',
                                borderRadius: '6px',
                                marginBottom: '15px'
                            }}>
                                <p style={{margin: 0, fontWeight: 'bold', color: '#065f46'}}>
                                    正在處理：{batchProgress.projectName}
                                </p>
                            </div>
                        )}

                        {/* PDF 頁面進度 */}
                        {batchProgress.totalPages > 0 && (
                            <div>
                                <div style={{display: 'flex', justifyContent: 'space-between', marginBottom: '8px'}}>
                                    <span style={{fontSize: '14px'}}>PDF 頁面上傳</span>
                                    <span style={{fontSize: '14px', color: '#059669'}}>
                                        {batchProgress.currentPage} / {batchProgress.totalPages}
                                    </span>
                                </div>
                                <div style={{
                                    width: '100%',
                                    height: '20px',
                                    background: '#e5e7eb',
                                    borderRadius: '10px',
                                    overflow: 'hidden'
                                }}>
                                    <div style={{
                                        width: `${(batchProgress.currentPage / batchProgress.totalPages) * 100}%`,
                                        height: '100%',
                                        background: 'linear-gradient(90deg, #34d399, #10b981)',
                                        transition: 'width 0.3s ease'
                                    }} />
                                </div>
                            </div>
                        )}

                        {/* 狀態訊息 */}
                        {uploadProgress && (
                            <p style={{
                                marginTop: '15px',
                                padding: '10px',
                                background: '#eff6ff',
                                borderRadius: '4px',
                                color: '#1e40af',
                                fontSize: '14px',
                                textAlign: 'center',
                                margin: '15px 0 0 0'
                            }}>
                                {uploadProgress}
                            </p>
                        )}
                    </div>
                )}

                {showBatchResults && batchResults && (
                    <div style={{
                        marginTop: '20px',
                        padding: '15px',
                        background: 'white',
                        borderRadius: '8px',
                        border: '1px solid #d1d5db'
                    }}>
                        <h3 style={{marginBottom: '15px'}}>📊 批次上傳結果</h3>
                        <div style={{marginBottom: '15px'}}>
                            <p><strong>總專案數：</strong>{batchResults.totalProjects}</p>
                            <p style={{color: '#10b981'}}><strong>成功：</strong>{batchResults.successProjects}</p>
                            <p style={{color: '#ef4444'}}><strong>失敗：</strong>{batchResults.failedProjects}</p>
                        </div>
                        <div style={{maxHeight: '300px', overflow: 'auto'}}>
                            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '14px'}}>
                                <thead>
                                    <tr style={{borderBottom: '2px solid #ddd', background: '#f9fafb'}}>
                                        <th style={{textAlign: 'left', padding: '8px'}}>專案名稱</th>
                                        <th style={{textAlign: 'left', padding: '8px'}}>狀態</th>
                                        <th style={{textAlign: 'left', padding: '8px'}}>訊息</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {batchResults.details.map((detail, idx) => (
                                        <tr key={idx} style={{borderBottom: '1px solid #eee'}}>
                                            <td style={{padding: '8px'}}>{detail.projectName}</td>
                                            <td style={{padding: '8px'}}>
                                                <span style={{
                                                    padding: '4px 8px',
                                                    borderRadius: '4px',
                                                    background: detail.success ? '#d1fae5' : '#fee2e2',
                                                    color: detail.success ? '#065f46' : '#991b1b',
                                                    fontSize: '12px'
                                                }}>
                                                    {detail.success ? '✓ 成功' : '✗ 失敗'}
                                                </span>
                                            </td>
                                            <td style={{padding: '8px', fontSize: '13px'}}>
                                                {detail.success ? detail.message : detail.error}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <button
                            className="btn"
                            onClick={() => setShowBatchResults(false)}
                            style={{marginTop: '15px', background: '#6b7280', color: 'white'}}
                        >
                            關閉結果
                        </button>
                    </div>
                )}
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
                            <th style={{textAlign: 'left', padding: '8px'}}>所屬群組</th>
                            <th style={{textAlign: 'left', padding: '8px'}}>總任務</th>
                            <th style={{textAlign: 'left', padding: '8px'}}>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projects.map(p => (
                            <tr key={p.id} style={{borderBottom: '1px solid #eee'}}>
                                <td style={{padding: '8px'}}>
                                    {editingProjectId === p.id ? (
                                        <div style={{display: 'flex', gap: '5px', alignItems: 'center'}}>
                                            <input
                                                type="text"
                                                value={editingProjectName}
                                                onChange={(e) => setEditingProjectName(e.target.value)}
                                                style={{
                                                    padding: '4px 8px',
                                                    border: '2px solid #3b82f6',
                                                    borderRadius: '4px',
                                                    fontSize: '13px',
                                                    flex: 1
                                                }}
                                                autoFocus
                                            />
                                            <button
                                                onClick={() => handleSaveProjectName(p.id)}
                                                style={{
                                                    padding: '4px 8px',
                                                    background: '#10b981',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    fontSize: '11px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                ✓
                                            </button>
                                            <button
                                                onClick={handleCancelEditProjectName}
                                                style={{
                                                    padding: '4px 8px',
                                                    background: '#6b7280',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '4px',
                                                    fontSize: '11px',
                                                    cursor: 'pointer'
                                                }}
                                            >
                                                ✗
                                            </button>
                                        </div>
                                    ) : (
                                        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                                            <span>{p.name}</span>
                                            <button
                                                onClick={() => handleStartEditProjectName(p.id, p.name)}
                                                style={{
                                                    padding: '2px 6px',
                                                    background: '#3b82f6',
                                                    color: 'white',
                                                    border: 'none',
                                                    borderRadius: '3px',
                                                    fontSize: '10px',
                                                    cursor: 'pointer'
                                                }}
                                                title="編輯專案名稱"
                                            >
                                                ✏️
                                            </button>
                                        </div>
                                    )}
                                </td>
                                <td style={{padding: '8px'}}>
                                    {isMigrated && groups.length > 0 ? (
                                        <select
                                            value={p.group_id || ''}
                                            onChange={(e) => handleAssignProjectToGroup(p.id, e.target.value || null)}
                                            style={{
                                                padding: '4px 8px',
                                                borderRadius: '4px',
                                                border: '1px solid #d1d5db',
                                                fontSize: '12px',
                                                background: p.group_id ? '#f3e8ff' : 'white'
                                            }}
                                        >
                                            <option value="">無群組</option>
                                            {groups.map(g => (
                                                <option key={g.id} value={g.id}>{g.name}</option>
                                            ))}
                                        </select>
                                    ) : (
                                        <span style={{fontSize: '12px', color: '#9ca3af'}}>
                                            {p.group_name || '無群組'}
                                        </span>
                                    )}
                                </td>
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
                                        className="btn"
                                        onClick={() => handleDeleteProjectOnly(p.id)}
                                        disabled={isUploading}
                                        style={{
                                            background: '#f59e0b',
                                            color: 'white',
                                            marginRight: '10px',
                                            fontSize: '12px',
                                            padding: '6px 12px',
                                            opacity: isUploading ? 0.5 : 1,
                                            cursor: isUploading ? 'not-allowed' : 'pointer'
                                        }}
                                        title="僅刪除專案記錄，保留 PDF 和標註資料"
                                    >
                                        🗑️ 軟刪除
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
                                        title="完全刪除專案、PDF 和所有資料"
                                    >
                                        🗑️ 完全刪除
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