// 檔案路徑: app/page.js
'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  registerUser,
  loginUser,
  getProjectsWithProgress,
  getNextTaskForUser,
  getPreviousTaskForUser,
  getNextTaskAfterCurrent,
  getAllTasksWithStatus,
  getTaskBySequence,
  validateCompletedAnnotations,
  resetProjectAnnotations,
  saveAnnotation,
  getActiveAnnouncements,
  updateSourceDataPageNumber,
  toggleAnnotationMark,
  getProjectTasksOverview
} from './actions';
import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('../components/PDFViewer'), {
  ssr: false,
  loading: () => <div className="pdf-status">正在載入 PDF 瀏覽器...</div>
});

function LoginRegisterScreen({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    if (!username || !password) {
      setMessage('使用者名稱和密碼不能為空');
      return;
    }
    setMessage('載入中...');
    let result;
    if (isLogin) {
      result = await loginUser(username, password);
      if (result.success) {
        onLoginSuccess(result.user);
      } else {
        setMessage(`登入失敗: ${result.error}`);
      }
    } else {
      result = await registerUser(username, password);
      if (result.success) {
        setMessage('註冊成功！請切換到登入頁面進行登入。');
        setIsLogin(true);
      } else {
        setMessage(`註冊失敗: ${result.error}`);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  return (
    <div className="modal" style={{ display: 'block' }}>
      <div className="modal-content">
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <img src="/ntpu-logo.png" alt="國立臺北大學" style={{ maxWidth: '300px', height: 'auto' }} />
        </div>
        <h2>{isLogin ? '登入' : '註冊'}</h2>
        <input 
          type="text" 
          value={username} 
          onChange={e => setUsername(e.target.value)} 
          onKeyDown={handleKeyDown}
          placeholder="使用者名稱" 
        />
        <input 
          type="password" 
          value={password} 
          onChange={e => setPassword(e.target.value)} 
          onKeyDown={handleKeyDown}
          placeholder="密碼" 
        />
        <button onClick={handleSubmit}>{isLogin ? '登入' : '註冊'}</button>
        <p style={{ color: message.includes('失敗') ? 'red' : 'green', marginTop: '10px', height: '20px' }}>{message}</p>
        <button onClick={() => {setIsLogin(!isLogin); setMessage('');}} style={{ background: 'grey', marginTop: '10px' }}>
          切換到 {isLogin ? '註冊' : '登入'}
        </button>
      </div>
    </div>
  );
}

function ProjectSelectionScreen({ user, onProjectSelect, onLogout }) {
  const [projects, setProjects] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [reannotationCount, setReannotationCount] = useState(0);

  useEffect(() => {
    async function fetchProjects() {
      const { projects, error } = await getProjectsWithProgress(user.id);
      if (error) alert(error);
      else setProjects(projects);
    }

    async function fetchAnnouncements() {
      const { success, announcements } = await getActiveAnnouncements();
      if (success) setAnnouncements(announcements);
    }

    async function fetchReannotationQueue() {
      try {
        const response = await fetch(`/api/reannotation/queue?userId=${user.id}`);
        const result = await response.json();
        if (result.success && result.data.stats) {
          setReannotationCount(result.data.stats.pendingTasks);
        }
      } catch (error) {
        console.error('載入重標註任務失敗:', error);
      }
    }

    fetchProjects();
    fetchAnnouncements();
    fetchReannotationQueue();
  }, [user.id]);

  return (
    <div className="container">
      <div className="panel" style={{ maxWidth: '600px', margin: '50px auto' }}>
        <div style={{ textAlign: 'center', marginBottom: '30px' }}>
          <img src="/ntpu-logo.png" alt="國立臺北大學" style={{ maxWidth: '300px', height: 'auto', marginBottom: '20px' }} />
          <h1 style={{ fontSize: '24px', marginBottom: '10px', color: '#1f2937' }}>AI CUP：ESG 報告承諾驗證標註資料收集</h1>
          <p style={{ fontSize: '16px', color: '#6b7280', marginBottom: '20px' }}>AI CUP: ESG Report Promise Validation Annotation Data Collection</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2>你好, {user.username}!</h2>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              {user.role === 'admin' && (
                <Link href="/admin" className="btn btn-purple" style={{marginRight: '0'}}>
                  管理後台
                </Link>
              )}
              <button onClick={onLogout} className="btn" style={{background: '#666', color: 'white'}}>登出</button>
            </div>
        </div>

        {/* 公告區域 */}
        {announcements.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            {announcements.map(announcement => {
              const typeStyles = {
                info: { bg: '#dbeafe', border: '#3b82f6', icon: 'ℹ️' },
                warning: { bg: '#fed7aa', border: '#f59e0b', icon: '⚠️' },
                success: { bg: '#d1fae5', border: '#10b981', icon: '✅' },
                error: { bg: '#fecaca', border: '#ef4444', icon: '❌' }
              };
              const style = typeStyles[announcement.type] || typeStyles.info;

              return (
                <div
                  key={announcement.id}
                  style={{
                    padding: '15px',
                    marginBottom: '15px',
                    background: style.bg,
                    border: `2px solid ${style.border}`,
                    borderRadius: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'start' }}>
                    <span style={{ fontSize: '20px', marginRight: '10px' }}>{style.icon}</span>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: 0, marginBottom: '8px', fontSize: '16px', fontWeight: 'bold' }}>
                        {announcement.title}
                      </h3>
                      <p style={{ margin: 0, fontSize: '14px', whiteSpace: 'pre-wrap' }}>
                        {announcement.content}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 重標註任務提示 */}
        {reannotationCount > 0 && (
          <div style={{
            padding: '15px',
            marginBottom: '20px',
            background: '#fef3c7',
            border: '2px solid #f59e0b',
            borderRadius: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'start' }}>
              <span style={{ fontSize: '20px', marginRight: '10px' }}>🔄</span>
              <div style={{ flex: 1 }}>
                <h3 style={{ margin: 0, marginBottom: '8px', fontSize: '16px', fontWeight: 'bold' }}>
                  你有 {reannotationCount} 個重標註任務待處理
                </h3>
                <p style={{ margin: 0, fontSize: '14px', marginBottom: '10px' }}>
                  管理員發現部分標註的一致性較低，需要您重新檢視並修改。
                </p>
                <Link
                  href="/reannotation"
                  style={{
                    display: 'inline-block',
                    padding: '8px 16px',
                    background: '#f59e0b',
                    color: 'white',
                    borderRadius: '6px',
                    textDecoration: 'none',
                    fontSize: '14px',
                    fontWeight: '600'
                  }}
                >
                  前往處理重標註任務 →
                </Link>
              </div>
            </div>
          </div>
        )}

        <p>請選擇要標註的公司專案:</p>
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '20px' }}>
          {projects.map(p => {
            const total = parseInt(p.total_tasks, 10);
            const completed = parseInt(p.completed_tasks, 10);
            const percentage = total > 0 ? ((completed / total) * 100).toFixed(0) : 0;
            return (
              <li key={p.id} style={{ margin: '15px 0', cursor: 'pointer' }} onClick={() => onProjectSelect(p)}>
                <div className="btn btn-primary" style={{ width: '100%', textAlign: 'left', padding: '15px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <strong>{p.name}</strong>
                    <span>{completed} / {total} ({percentage}%)</span>
                  </div>
                  <div style={{ background: '#e5e7eb', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                    <div style={{ width: `${percentage}%`, background: '#10b981', height: '100%'}}></div>
                  </div>
                </div>
              </li>
            )
          })}
          {projects.length === 0 && <p>目前沒有可標註的專案。</p>}
        </ul>
      </div>
    </div>
  );
}

function AllTasksOverviewScreen({ user, project, onBack, onJumpToTask }) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchTasks() {
            setLoading(true);
            const res = await getProjectTasksOverview(project.id, user.id);
            if (res.success) {
                setTasks(res.tasks);
            } else {
                alert('載入失敗: ' + res.error);
            }
            setLoading(false);
        }
        fetchTasks();
    }, [project.id, user.id]);

    if (loading) return <div className="container"><div className="panel">載入中...</div></div>;

    return (
        <div className="container">
            <div className="header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h1 style={{ fontSize: '20px', margin: 0 }}>{project.name} - 所有資料總覽</h1>
                <button 
                    onClick={onBack} 
                    className="btn" 
                    style={{ background: '#10b981', color: 'white', fontWeight: 'bold' }}
                >
                    回到標註頁面
                </button>
            </div>

            <div className="panel" style={{ background: '#f9fafb', minHeight: '600px' }}>
                <div style={{ 
                    display: 'grid', 
                    gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', 
                    gap: '15px' 
                }}>
                    {tasks.map(task => (
                        <div 
                            key={task.id} 
                            onClick={() => onJumpToTask(task.sequence)}
                            style={{
                                background: 'white',
                                border: '1px solid #e5e7eb',
                                borderRadius: '8px',
                                padding: '15px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '15px',
                                transition: 'transform 0.1s, box-shadow 0.1s',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                            }}
                        >
                            <div style={{ fontSize: '24px', color: task.is_marked ? '#f59e0b' : '#d1d5db' }}>
                                {task.is_marked ? '★' : '☆'}
                            </div>
                            <div style={{ flex: 1, overflow: 'hidden' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '5px', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    第 {task.sequence} 筆
                                    {task.skipped && <span style={{ fontSize: '12px', background: '#fef3c7', color: '#b45309', padding: '2px 6px', borderRadius: '4px' }}>待補</span>}
                                    {task.status === 'completed' && !task.skipped && <span style={{ fontSize: '12px', background: '#d1fae5', color: '#065f46', padding: '2px 6px', borderRadius: '4px' }}>完成</span>}
                                </div>
                                <div style={{ color: '#6b7280', fontSize: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {task.preview_text}...
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function AnnotationScreen({ user, project, onBack, onShowOverview, initialSequence, onJumpConsumed }) {
    const [currentItem, setCurrentItem] = useState(undefined);
    const [progress, setProgress] = useState({ completed: 0, total: 0 });
    const [esgTypes, setEsgTypes] = useState([]);
    const [promiseStatus, setPromiseStatus] = useState('');
    const [verificationTimeline, setVerificationTimeline] = useState('');
    const [evidenceStatus, setEvidenceStatus] = useState('');
    const [evidenceQuality, setEvidenceQuality] = useState('');
    const [skippedCount, setSkippedCount] = useState(0);
    const [allTasks, setAllTasks] = useState([]);
    const [selectedSequence, setSelectedSequence] = useState('');
    const [isMarked, setIsMarked] = useState(false);
    const [validationResult, setValidationResult] = useState(null);
    const [showPageAdjust, setShowPageAdjust] = useState(false);
    const [newPageNumber, setNewPageNumber] = useState('');
    const [autoAlignProgress, setAutoAlignProgress] = useState(null);
    const [suggestedPage, setSuggestedPage] = useState(null);
    const [batchAlignProgress, setBatchAlignProgress] = useState(null);
    const [showBatchResult, setShowBatchResult] = useState(false);
    const dataTextRef = useRef(null);

    useEffect(() => { loadTask(); }, []);

    // 處理從總覽頁面跳轉回來的請求
    useEffect(() => {
        if (initialSequence) {
            const jump = async () => {
                const res = await getTaskBySequence(project.id, user.id, initialSequence);
                if (res.task) {
                    setCurrentItem(res.task);
                    loadTaskData(res.task);
                }
                if (onJumpConsumed) onJumpConsumed();
            };
            jump();
        }
    }, [initialSequence]);

    useEffect(() => {
        if (currentItem && dataTextRef.current) {
            // 如果有已儲存的標註資料，恢復高亮；否則只顯示原始文本
            if (currentItem.promise_string || currentItem.evidence_string) {
                restoreHighlights(currentItem);
            } else {
                dataTextRef.current.innerHTML = currentItem.original_data;
            }
        } else if (currentItem === null && progress.completed + skippedCount >= progress.total && progress.total > 0) {
            // 只有在真正完成所有標註時（已完成 + 已跳過 = 總題數），才自動執行驗證
            handleValidateData();
        }
    }, [currentItem, progress, skippedCount]);

    const loadTask = async () => {
        const taskRes = await getNextTaskForUser(project.id, user.id);
        if (taskRes.task) {
            setCurrentItem(taskRes.task);
            loadTaskData(taskRes.task);
        } else {
            setCurrentItem(null);
        }

        const projRes = await getProjectsWithProgress(user.id);
        const proj = projRes.projects?.find(p => p.id === project.id);
        if (proj) {
            setProgress({
                completed: parseInt(proj.completed_tasks) || 0,
                total: parseInt(proj.total_tasks) || 0
            });
        }

        // 載入所有任務及其狀態
        const allTasksRes = await getAllTasksWithStatus(project.id, user.id);
        if (allTasksRes.tasks) {
            setAllTasks(allTasksRes.tasks);
            // 計算跳過數量
            const skipped = allTasksRes.tasks.filter(t => t.skipped === true).length;
            setSkippedCount(skipped);
        }
    };

    const loadPreviousTask = async () => {
        // 如果 currentItem 是 null（已完成所有標註），傳入 null 讓後端返回最後一筆
        const currentId = currentItem ? currentItem.id : null;
        const res = await getPreviousTaskForUser(project.id, user.id, currentId);
        if (res.task) {
            setCurrentItem(res.task);
            loadTaskData(res.task);
        } else {
            alert('沒有上一筆資料');
        }
    };

    const loadTaskData = (task) => {
        // esg_type 現在是陣列格式，不需要 split
        setEsgTypes(Array.isArray(task.esg_type) ? task.esg_type : (task.esg_type ? task.esg_type.split(',') : []));
        setPromiseStatus(task.promise_status || '');
        setVerificationTimeline(task.verification_timeline || '');
        setEvidenceStatus(task.evidence_status || '');
        setEvidenceQuality(task.evidence_quality || '');
        setIsMarked(task.is_marked || false);

        // 恢復高亮標記
        if (dataTextRef.current) {
            restoreHighlights(task);
        }
    };

    const handleToggleMark = async () => {
        if (!currentItem) return;
        
        const newState = !isMarked;
        setIsMarked(newState);

        try {
            const result = await toggleAnnotationMark(currentItem.id, user.id);
            if (!result.success) {
                setIsMarked(!newState);
                alert(`標記失敗: ${result.error}`);
            } else {
                setAllTasks(prev => prev.map(t => 
                    t.id === currentItem.id ? { ...t, is_marked: newState } : t
                ));
            }
        } catch (error) {
            setIsMarked(!newState);
            console.error(error);
        }
    };

    const handleResetProject = async () => {
        if (window.confirm('確定要重置此專案嗎？將刪除您在此專案的所有標註記錄！')) {
            const result = await resetProjectAnnotations(project.id, user.id);
            if (result.success) {
                alert('重置成功！');
                loadTask();
            } else {
                alert(`重置失敗: ${result.error}`);
            }
        }
    };

    const handleSaveAndNext = async () => {
        if (!currentItem) return;

        if (!promiseStatus) return alert('請選擇承諾狀態');

        const promiseText = getHighlightedText('promise');
        const evidenceText = getHighlightedText('evidence');

        if (promiseStatus === 'Yes') {
            if (!promiseText || promiseText.trim() === '') {
                return alert('承諾狀態為 Yes，請在文本中標記承諾文字（黃色）');
            }
            if (!verificationTimeline) return alert('請選擇驗證時間軸');
            if (!evidenceStatus) return alert('請選擇證據狀態');
            if (evidenceStatus === 'Yes') {
                if (!evidenceText || evidenceText.trim() === '') {
                    return alert('證據狀態為 Yes，請在文本中標記證據文字（藍色）');
                }
                if (!evidenceQuality) return alert('請選擇證據品質');
            }
        }

        const annotationData = {
            source_data_id: currentItem.id,
            user_id: user.id,
            esg_type: esgTypes.join(','),
            promise_status: promiseStatus,
            promise_string: promiseText,
            verification_timeline: verificationTimeline,
            evidence_status: evidenceStatus,
            evidence_string: evidenceText,
            evidence_quality: evidenceQuality
        };

        const result = await saveAnnotation(annotationData);
        if (!result.success) {
            alert(`儲存失敗: ${result.error}`);
            return;
        }

        // 清除所有標記（切換到下一筆時重置）
        if (dataTextRef.current && currentItem) {
            dataTextRef.current.innerHTML = currentItem.original_data;
        }
        setEsgTypes([]);
        setPromiseStatus('');
        setVerificationTimeline('');
        setEvidenceStatus('');
        setEvidenceQuality('');

        // 載入當前項目之後的下一筆（不管是否已標註）
        const nextRes = await getNextTaskAfterCurrent(project.id, user.id, currentItem.id);
        if (nextRes.task) {
            setCurrentItem(nextRes.task);
            loadTaskData(nextRes.task);
        } else {
            // 如果沒有下一筆，顯示完成訊息
            setCurrentItem(null);
        }

        // 更新進度
        const projRes = await getProjectsWithProgress(user.id);
        const proj = projRes.projects?.find(p => p.id === project.id);
        if (proj) setProgress({
            completed: parseInt(proj.completed_tasks) || 0,
            total: parseInt(proj.total_tasks) || 0
        });

        // 重新載入所有任務及其狀態
        const allTasksRes = await getAllTasksWithStatus(project.id, user.id);
        if (allTasksRes.tasks) {
            setAllTasks(allTasksRes.tasks);
            const skipped = allTasksRes.tasks.filter(t => t.skipped === true).length;
            setSkippedCount(skipped);
        }

        // 如果有驗證結果，重新驗證以更新警告框
        if (validationResult) {
            const newValidation = await validateCompletedAnnotations(project.id, user.id);
            if (!newValidation.error) {
                setValidationResult(newValidation);
            }
        }
    };

    const handleSkip = async () => {
        if (!currentItem) return;

        const annotationData = {
            source_data_id: currentItem.id,
            user_id: user.id,
            esg_type: '',
            promise_status: '',
            promise_string: '',
            verification_timeline: '',
            evidence_status: '',
            evidence_string: '',
            evidence_quality: '',
            skipped: true
        };

        const result = await saveAnnotation(annotationData);
        if (!result.success) {
            alert(`儲存失敗: ${result.error}`);
            return;
        }

        // 清除所有標記（切換到下一筆時重置）
        if (dataTextRef.current && currentItem) {
            dataTextRef.current.innerHTML = currentItem.original_data;
        }
        setEsgTypes([]);
        setPromiseStatus('');
        setVerificationTimeline('');
        setEvidenceStatus('');
        setEvidenceQuality('');

        // 載入下一筆未標註的資料（而不是順序的下一筆）
        const nextRes = await getNextTaskForUser(project.id, user.id);
        if (nextRes.task) {
            setCurrentItem(nextRes.task);
            loadTaskData(nextRes.task);
        } else {
            setCurrentItem(null);
        }

        // 更新進度和任務列表
        const projRes = await getProjectsWithProgress(user.id);
        const proj = projRes.projects?.find(p => p.id === project.id);
        if (proj) setProgress({
            completed: parseInt(proj.completed_tasks) || 0,
            total: parseInt(proj.total_tasks) || 0
        });

        // 重新載入所有任務及其狀態
        const allTasksRes = await getAllTasksWithStatus(project.id, user.id);
        if (allTasksRes.tasks) {
            setAllTasks(allTasksRes.tasks);
            const skipped = allTasksRes.tasks.filter(t => t.skipped === true).length;
            setSkippedCount(skipped);
        }

        // 如果有驗證結果，重新驗證以更新警告框
        if (validationResult) {
            const newValidation = await validateCompletedAnnotations(project.id, user.id);
            if (!newValidation.error) {
                setValidationResult(newValidation);
            }
        }
    };

    const handleSequenceJump = async (e) => {
        const sequence = e.target.value;
        if (!sequence) return;

        const seqNum = parseInt(sequence);
        const res = await getTaskBySequence(project.id, user.id, seqNum);
        if (res.task) {
            setCurrentItem(res.task);
            loadTaskData(res.task);
            setSelectedSequence('');
        } else {
            alert(`找不到第 ${seqNum} 筆資料`);
        }
    };

    const handlePageNumberAdjust = async () => {
        if (!currentItem) return;
        if (!newPageNumber || newPageNumber.trim() === '') {
            alert('請輸入新的頁碼');
            return;
        }

        const pageNum = parseInt(newPageNumber);
        if (isNaN(pageNum) || pageNum < 1) {
            alert('請輸入有效的頁碼（大於 0 的整數）');
            return;
        }

        if (confirm(`確定要將此筆資料的頁碼從 ${currentItem.page_number} 調整為 ${pageNum} 嗎？`)) {
            const result = await updateSourceDataPageNumber(currentItem.id, pageNum, user.id);
            if (result.success) {
                alert(`頁碼調整成功！\n新頁碼：${result.newPageNumber}\n新 PDF URL：${result.newPdfUrl}`);
                // 重新載入當前資料
                const res = await getTaskBySequence(project.id, user.id, allTasks.find(t => t.id === currentItem.id)?.sequence);
                if (res.task) {
                    setCurrentItem(res.task);
                    loadTaskData(res.task);
                }
                setShowPageAdjust(false);
                setNewPageNumber('');
                setSuggestedPage(null);
            } else {
                alert(`調整失敗：${result.error}`);
            }
        }
    };

    const handleAutoAlign = async () => {
        if (!currentItem) return;

        try {
            setAutoAlignProgress({ current: 0, total: 0, status: '準備中...' });
            setSuggestedPage(null);

            // 動態載入 pdfjs-dist
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

            // 取得專案的所有 PDF URLs（從第一筆資料獲取）
            const projectData = await fetch('/api/get-project-pdf-urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id })
            });
            const { pdfUrls } = await projectData.json();

            if (!pdfUrls || Object.keys(pdfUrls).length === 0) {
                alert('找不到專案的 PDF 檔案');
                setAutoAlignProgress(null);
                return;
            }

            // 取得當前資料的文本（移除多餘空白）
            const targetText = currentItem.original_data.replace(/\s+/g, ' ').trim().toLowerCase();
            const totalPages = Object.keys(pdfUrls).length;

            setAutoAlignProgress({ current: 0, total: totalPages, status: '開始分析...' });

            let bestMatch = { pageNumber: null, similarity: 0 };
            const searchRange = 20; // 搜尋範圍：當前頁前後 20 頁
            const currentPage = currentItem.page_number;
            const startPage = Math.max(1, currentPage - searchRange);
            const endPage = Math.min(totalPages, currentPage + searchRange);

            // 只搜尋範圍內的頁面
            for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
                const pdfUrl = pdfUrls[pageNum];
                if (!pdfUrl) continue;

                setAutoAlignProgress({
                    current: pageNum - startPage + 1,
                    total: endPage - startPage + 1,
                    status: `分析第 ${pageNum} 頁...`
                });

                try {
                    // 載入 PDF
                    const loadingTask = pdfjsLib.getDocument({
                        url: pdfUrl,
                        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/cmaps/',
                        cMapPacked: true
                    });
                    const pdf = await loadingTask.promise;
                    const page = await pdf.getPage(1); // 每個 PDF 只有一頁
                    const textContent = await page.getTextContent();

                    // 提取文本
                    const pageText = textContent.items
                        .map(item => item.str)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                    // 計算相似度
                    let similarity = 0;

                    // 重要：檢查「資料庫文本」是否在「PDF 文本」中
                    // 如果 PDF 包含資料庫的文本 = 找到正確頁面
                    if (pageText.includes(targetText)) {
                        similarity = 100; // PDF 完全包含資料庫文本
                    } else {
                        // 計算相似度：看有多少資料庫文本的字符出現在 PDF 中
                        const targetChars = new Set(targetText.split(''));
                        const pageChars = new Set(pageText.split(''));
                        const intersection = new Set([...targetChars].filter(x => pageChars.has(x)));
                        similarity = (intersection.size / targetChars.size) * 100;
                    }

                    if (similarity > bestMatch.similarity) {
                        bestMatch = { pageNumber: pageNum, similarity };
                    }

                    // 如果找到完全匹配，提前結束
                    if (similarity === 100) break;

                } catch (err) {
                    console.error(`分析第 ${pageNum} 頁時發生錯誤:`, err);
                }
            }

            setAutoAlignProgress(null);

            if (bestMatch.pageNumber) {
                setSuggestedPage(bestMatch);
                setNewPageNumber(bestMatch.pageNumber.toString());

                if (bestMatch.similarity === 100) {
                    alert(`找到完全匹配的頁面！\n建議頁碼：第 ${bestMatch.pageNumber} 頁\n相似度：${bestMatch.similarity.toFixed(1)}%`);
                } else {
                    alert(`找到最相似的頁面\n建議頁碼：第 ${bestMatch.pageNumber} 頁\n相似度：${bestMatch.similarity.toFixed(1)}%\n\n請確認後再點擊「確認調整」`);
                }
            } else {
                alert('找不到匹配的頁面，請手動輸入頁碼');
            }

        } catch (error) {
            console.error('自動對齊錯誤:', error);
            alert(`自動對齊失敗：${error.message}`);
            setAutoAlignProgress(null);
        }
    };

    const handleBatchAutoAlign = async () => {
        if (!confirm(`確定要對整個專案「${project.name}」執行批次自動對齊嗎？\n\n此操作會：\n1. 掃描所有資料\n2. 自動比對 PDF 頁面\n3. 更新不正確的頁碼\n\n此過程可能需要幾分鐘，請耐心等待。`)) {
            return;
        }

        try {
            setBatchAlignProgress({
                current: 0,
                total: 0,
                status: '準備中...',
                alignedCount: 0,
                skippedCount: 0,
                errorCount: 0,
                details: []
            });
            setShowBatchResult(false);

            // 動態載入 pdfjs-dist
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

            // 取得專案的所有 PDF URLs
            const projectData = await fetch('/api/get-project-pdf-urls', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id })
            });
            const { pdfUrls } = await projectData.json();

            if (!pdfUrls || Object.keys(pdfUrls).length === 0) {
                alert('找不到專案的 PDF 檔案');
                setBatchAlignProgress(null);
                return;
            }

            // 取得所有資料
            const allTasksData = await fetch('/api/get-all-project-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, userId: user.id })
            });
            const { data: allData } = await allTasksData.json();

            if (!allData || allData.length === 0) {
                alert('專案沒有資料');
                setBatchAlignProgress(null);
                return;
            }

            setBatchAlignProgress(prev => ({
                ...prev,
                total: allData.length,
                status: `開始處理 ${allData.length} 筆資料...`
            }));

            const totalPages = Object.keys(pdfUrls).length;
            let alignedCount = 0;
            let skippedCount = 0;
            let errorCount = 0;
            const details = [];

            // 預先載入所有 PDF 文本
            setBatchAlignProgress(prev => ({ ...prev, status: '預先載入 PDF 文本...' }));
            const pdfTextCache = {};

            for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
                const pdfUrl = pdfUrls[pageNum];
                if (!pdfUrl) continue;

                try {
                    const loadingTask = pdfjsLib.getDocument({
                        url: pdfUrl,
                        cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/cmaps/',
                        cMapPacked: true
                    });
                    const pdf = await loadingTask.promise;
                    const page = await pdf.getPage(1);
                    const textContent = await page.getTextContent();

                    const pageText = textContent.items
                        .map(item => item.str)
                        .join(' ')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .toLowerCase();

                    pdfTextCache[pageNum] = pageText;
                    console.log(`[PDF 載入] 第 ${pageNum} 頁，文本長度: ${pageText.length}`);
                } catch (err) {
                    console.error(`載入第 ${pageNum} 頁時發生錯誤:`, err);
                    pdfTextCache[pageNum] = '';
                }
            }

            // 處理每筆資料
            for (let i = 0; i < allData.length; i++) {
                const dataItem = allData[i];

                setBatchAlignProgress(prev => ({
                    ...prev,
                    current: i + 1,
                    status: `處理第 ${i + 1}/${allData.length} 筆 (ID: ${dataItem.id})...`
                }));

                try {
                    const targetText = dataItem.original_data.replace(/\s+/g, ' ').trim().toLowerCase();
                    let bestMatch = { pageNumber: null, similarity: 0 };

                    const searchRange = 20;
                    const currentPage = dataItem.page_number;
                    const startPage = Math.max(1, currentPage - searchRange);
                    const endPage = Math.min(totalPages, currentPage + searchRange);

                    // 搜尋最佳匹配
                    for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
                        const pageText = pdfTextCache[pageNum];
                        if (!pageText) continue;

                        let similarity = 0;

                        if (pageText.includes(targetText)) {
                            similarity = 100;
                        } else {
                            const targetChars = new Set(targetText.split(''));
                            const pageChars = new Set(pageText.split(''));
                            const intersection = new Set([...targetChars].filter(x => pageChars.has(x)));
                            similarity = (intersection.size / targetChars.size) * 100;
                        }

                        if (similarity > bestMatch.similarity) {
                            bestMatch = { pageNumber: pageNum, similarity };
                        }

                        if (similarity === 100) break;
                    }

                    console.log(`[比對] ID ${dataItem.id}: 當前頁=${currentPage}, 最佳匹配=${bestMatch.pageNumber}, 相似度=${bestMatch.similarity.toFixed(1)}%`);

                    // 如果找到匹配且與當前頁碼不同，則更新
                    if (bestMatch.pageNumber && bestMatch.pageNumber !== dataItem.page_number && bestMatch.similarity >= 50) {
                        const result = await updateSourceDataPageNumber(dataItem.id, bestMatch.pageNumber, user.id);

                        if (result.success) {
                            alignedCount++;
                            details.push({
                                id: dataItem.id,
                                oldPage: dataItem.page_number,
                                newPage: bestMatch.pageNumber,
                                similarity: bestMatch.similarity.toFixed(1)
                            });
                        } else {
                            errorCount++;
                        }
                    } else {
                        skippedCount++;
                        // 記錄跳過原因
                        if (!bestMatch.pageNumber || bestMatch.similarity < 50) {
                            console.log(`[跳過] ID ${dataItem.id}: 找不到足夠相似的頁面 (最佳匹配: ${bestMatch.pageNumber || 'N/A'}, 相似度: ${bestMatch.similarity.toFixed(1)}%)`);
                        } else {
                            console.log(`[跳過] ID ${dataItem.id}: 頁碼已正確 (當前頁=${currentPage}, 最佳匹配=${bestMatch.pageNumber})`);
                        }
                    }

                } catch (error) {
                    console.error(`處理資料 ${dataItem.id} 時發生錯誤:`, error);
                    errorCount++;
                }
            }

            // 完成
            setBatchAlignProgress({
                current: allData.length,
                total: allData.length,
                status: '完成！',
                alignedCount,
                skippedCount,
                errorCount,
                details,
                completed: true
            });
            setShowBatchResult(true);

            // 重新載入當前任務
            loadTask();

            alert(`批次對齊完成！\n\n總共處理：${allData.length} 筆\n已調整：${alignedCount} 筆\n跳過：${skippedCount} 筆\n錯誤：${errorCount} 筆`);

            // 如果有跳過的資料，檢查是否有 URL 不匹配的問題
            if (skippedCount > 0) {
                const checkResult = await fetch('/api/check-skipped-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ projectId: project.id, userId: user.id })
                });
                const { mismatches, mismatch_count } = await checkResult.json();

                if (mismatch_count > 0) {
                    console.log(`[資料庫檢查] 發現 ${mismatch_count} 筆 URL 不匹配的資料:`, mismatches);
                    alert(`⚠️ 發現 ${mismatch_count} 筆資料的 URL 與頁碼不匹配！\n請查看 Console 了解詳情。`);
                }
            }

        } catch (error) {
            console.error('批次對齊錯誤:', error);
            alert(`批次對齊失敗：${error.message}`);
            setBatchAlignProgress(null);
        }
    };

    const handleAutoFixUrlMismatch = async () => {
        if (!confirm('確定要自動修復所有 URL 與頁碼不匹配的資料嗎？\n\n此操作會將 source_url 更新為對應頁碼的正確 URL。')) {
            return;
        }

        try {
            const response = await fetch('/api/auto-fix-url-mismatch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectId: project.id, userId: user.id })
            });

            const result = await response.json();

            if (result.success) {
                console.log('[自動修復結果]', result);
                alert(`✅ 自動修復完成！\n\n總共檢查：${result.total} 筆\n已修復：${result.fixed_count} 筆\n錯誤：${result.error_count} 筆\n\n請查看 Console 了解詳情。`);

                // 重新載入當前任務
                loadTask();
            } else {
                alert(`修復失敗：${result.error}`);
            }
        } catch (error) {
            console.error('自動修復錯誤:', error);
            alert(`自動修復失敗：${error.message}`);
        }
    };

    const handleValidateData = async () => {
        const result = await validateCompletedAnnotations(project.id, user.id);

        if (result.error) {
            alert(`驗證失敗: ${result.error}`);
            return;
        }

        // 儲存驗證結果供後續使用
        setValidationResult(result);

        // 計算統計資料 - 更詳細的問題分類
        const issueStats = {
            noPromiseStatus: 0,
            noPromiseMark: 0,
            noTimeline: 0,
            noEvidenceStatus: 0,
            noEvidenceMark: 0,
            noEvidenceQuality: 0
        };

        result.invalidTasks.forEach(t => {
            if (t.issues.includes('未選擇承諾狀態')) issueStats.noPromiseStatus++;
            if (t.issues.includes('缺少承諾標記')) issueStats.noPromiseMark++;
            if (t.issues.includes('未選擇驗證時間軸')) issueStats.noTimeline++;
            if (t.issues.includes('未選擇證據狀態')) issueStats.noEvidenceStatus++;
            if (t.issues.includes('缺少證據標記')) issueStats.noEvidenceMark++;
            if (t.issues.includes('未選擇證據品質')) issueStats.noEvidenceQuality++;
        });

        if (result.invalidCount === 0) {
            // 計算未完成的題數
            const remainingTasks = result.totalTasks - result.totalCompleted - skippedCount;

            const passMessage = [
                '✅ 驗證通過！',
                '',
                `📊 統計資料：`,
                `• 專案總題數：${result.totalTasks} 筆`,
                `• 已完成標註：${result.totalCompleted} 筆`,
                `• 不完整資料：0 筆`,
                `• 待補資料：${skippedCount} 筆`,
                `• 尚未標註：${remainingTasks} 筆`,
                '',
                remainingTasks > 0
                    ? `⚠️ 已完成的 ${result.totalCompleted} 筆資料都符合要求，但還有 ${remainingTasks} 筆尚未標註！\n\n💡 提醒：如果這是合併專案，部分資料可能由其他成員負責標註。`
                    : '✨ 所有已完成的標註資料都符合要求！'
            ].join('\n');

            alert(passMessage);
        } else {
            const issueList = result.invalidTasks.map(task =>
                `  • 第 ${task.sequence} 筆 (頁碼: ${task.pageNumber}): ${task.issues.join('、')}`
            ).join('\n');

            const statsLines = [];
            if (issueStats.noPromiseStatus > 0) statsLines.push(`  - 未選擇承諾狀態：${issueStats.noPromiseStatus} 筆`);
            if (issueStats.noPromiseMark > 0) statsLines.push(`  - 缺少承諾標記：${issueStats.noPromiseMark} 筆`);
            if (issueStats.noTimeline > 0) statsLines.push(`  - 未選擇驗證時間軸：${issueStats.noTimeline} 筆`);
            if (issueStats.noEvidenceStatus > 0) statsLines.push(`  - 未選擇證據狀態：${issueStats.noEvidenceStatus} 筆`);
            if (issueStats.noEvidenceMark > 0) statsLines.push(`  - 缺少證據標記：${issueStats.noEvidenceMark} 筆`);
            if (issueStats.noEvidenceQuality > 0) statsLines.push(`  - 未選擇證據品質：${issueStats.noEvidenceQuality} 筆`);

            // 計算未完成的題數
            const remainingTasks = result.totalTasks - result.totalCompleted - skippedCount;

            const summaryMessage = [
                '⚠️ 發現不完整的資料',
                '',
                `📊 統計資料：`,
                `• 專案總題數：${result.totalTasks} 筆`,
                `• 已完成標註：${result.totalCompleted} 筆`,
                `• 不完整資料：${result.invalidCount} 筆`,
                ...statsLines,
                `• 待補資料：${skippedCount} 筆`,
                `• 尚未標註：${remainingTasks} 筆`,
                '',
                '📋 問題清單：',
                issueList,
                '',
                '💡 提醒：',
                '• 必須選擇承諾狀態（Yes/No）',
                '• 承諾狀態為 Yes 時，必須：',
                '  1. 在文本中標記承諾文字（黃色）',
                '  2. 選擇驗證時間軸',
                '  3. 選擇證據狀態',
                '• 證據狀態為 Yes 時，必須：',
                '  1. 在文本中標記證據文字（藍色）',
                '  2. 選擇證據品質'
            ].join('\n');

            if (confirm(summaryMessage + '\n\n是否要跳轉到第一筆有問題的資料？')) {
                const firstInvalid = result.invalidTasks[0];
                const res = await getTaskBySequence(project.id, user.id, firstInvalid.sequence);
                if (res.task) {
                    setCurrentItem(res.task);
                    loadTaskData(res.task);
                }
            }
        }
    };

    const highlightSelection = (type) => {
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) return;
        
        const range = selection.getRangeAt(0);
        const container = dataTextRef.current;
        if (!container.contains(range.commonAncestorContainer)) return;
        
        const span = document.createElement('span');
        span.className = `highlight-${type}`;
        
        try {
            range.surroundContents(span);
        } catch (err) {
            console.warn('無法標記選取範圍:', err);
        }
        
        selection.removeAllRanges();
    };

    const getHighlightedText = (type) => {
        if (!dataTextRef.current) return '';

        // 獲取純文本內容（用於計算位置）
        const positions = [];

        // 遍歷所有高亮元素，計算它們在純文本中的位置
        const highlights = dataTextRef.current.querySelectorAll(`.highlight-${type}`);

        highlights.forEach(el => {
            // 計算這個元素在整個文本中的起始位置
            const range = document.createRange();
            range.selectNodeContents(dataTextRef.current);

            // 創建一個範圍到元素開始位置
            const preRange = range.cloneRange();
            preRange.setEnd(el.firstChild || el, 0);
            const startOffset = preRange.toString().length;
            const endOffset = startOffset + el.textContent.length;

            positions.push(`${startOffset}-${endOffset}`);
        });

        // 返回位置索引，例如：'10-15,45-50'
        return positions.join(',');
    };
    
    const checkCurrentItemCompleteness = () => {
        if (!currentItem || !validationResult) return null;

        // 從驗證結果中找到當前項目的序號
        const currentTask = allTasks.find(t => t.id === currentItem.id);
        if (!currentTask) return null;

        // 在驗證結果中找到對應的不完整任務
        const invalidTask = validationResult.invalidTasks.find(
            t => t.sequence === currentTask.sequence
        );

        return invalidTask ? invalidTask.issues : null;
    };

    const clearSelectedHighlights = () => {
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) {
            alert('請先選取要清除標記的文字');
            return;
        }

        const range = selection.getRangeAt(0);
        const container = dataTextRef.current;
        if (!container.contains(range.commonAncestorContainer)) return;

        // 取得選取範圍內的所有高亮元素
        const fragment = range.cloneContents();
        const highlights = fragment.querySelectorAll('.highlight-promise, .highlight-evidence');

        // 如果選取範圍內沒有高亮，檢查選取的文字是否在高亮元素內
        if (highlights.length === 0) {
            let node = range.commonAncestorContainer;
            // 如果是文字節點，往上找父元素
            if (node.nodeType === Node.TEXT_NODE) {
                node = node.parentElement;
            }

            // 檢查是否為高亮元素或其子元素
            const highlightParent = node.closest('.highlight-promise, .highlight-evidence');
            if (highlightParent) {
                // 移除高亮標記，保留文字
                const text = highlightParent.textContent;
                highlightParent.replaceWith(document.createTextNode(text));
                selection.removeAllRanges();
                return;
            }

            alert('選取範圍內沒有找到標記');
            return;
        }

        // 處理選取範圍內的高亮元素
        const allHighlights = container.querySelectorAll('.highlight-promise, .highlight-evidence');
        allHighlights.forEach(highlight => {
            if (range.intersectsNode(highlight)) {
                const text = highlight.textContent;
                highlight.replaceWith(document.createTextNode(text));
            }
        });

        selection.removeAllRanges();
    };

    const restoreHighlights = (task) => {
        if (!dataTextRef.current) return;

        // 先設定原始文本
        dataTextRef.current.innerHTML = task.original_data;

        // 獲取純文本內容
        const plainText = dataTextRef.current.textContent;

        // 恢復承諾高亮（使用位置索引）
        if (task.promise_string && task.promise_string.includes('-')) {
            // 新格式：位置索引（例如：'10-15,45-50'）
            highlightByPositions(task.promise_string, 'promise', plainText);
        } else if (task.promise_string) {
            // 舊格式：文本（向後兼容）
            const promiseTexts = task.promise_string.split(' ').filter(t => t.trim());
            promiseTexts.forEach(text => {
                highlightTextInContent(text.trim(), 'promise');
            });
        }

        // 恢復證據高亮（使用位置索引）
        if (task.evidence_string && task.evidence_string.includes('-')) {
            // 新格式：位置索引
            highlightByPositions(task.evidence_string, 'evidence', plainText);
        } else if (task.evidence_string) {
            // 舊格式：文本（向後兼容）
            const evidenceTexts = task.evidence_string.split(' ').filter(t => t.trim());
            evidenceTexts.forEach(text => {
                highlightTextInContent(text.trim(), 'evidence');
            });
        }
    };

    const highlightByPositions = (positionsStr, type, plainText) => {
        if (!dataTextRef.current || !positionsStr) return;

        // 解析位置索引：'10-15,45-50' -> [{start: 10, end: 15}, {start: 45, end: 50}]
        const positions = positionsStr.split(',').map(pos => {
            const [start, end] = pos.split('-').map(Number);
            return { start, end };
        });

        // 從後往前處理（避免位置偏移）
        positions.sort((a, b) => b.start - a.start);

        positions.forEach(({ start, end }) => {
            // 使用 TreeWalker 遍歷文本節點
            const walker = document.createTreeWalker(
                dataTextRef.current,
                NodeFilter.SHOW_TEXT,
                null
            );

            let currentOffset = 0;
            let node;

            while (node = walker.nextNode()) {
                const nodeLength = node.textContent.length;
                const nodeStart = currentOffset;
                const nodeEnd = currentOffset + nodeLength;

                // 檢查高亮範圍是否在這個文本節點內
                if (start >= nodeStart && end <= nodeEnd) {
                    // 高亮範圍完全在這個節點內
                    const relativeStart = start - nodeStart;
                    const relativeEnd = end - nodeStart;

                    const range = document.createRange();
                    range.setStart(node, relativeStart);
                    range.setEnd(node, relativeEnd);

                    const span = document.createElement('span');
                    span.className = `highlight-${type}`;
                    try {
                        range.surroundContents(span);
                    } catch (err) {
                        console.warn('無法標記範圍:', err);
                    }
                    break;
                }

                currentOffset = nodeEnd;
            }
        });
    };

    const highlightTextInContent = (searchText, type) => {
        if (!dataTextRef.current || !searchText) return;

        const container = dataTextRef.current;
        const innerHTML = container.innerHTML;

        // 使用正則表達式找到文字並加上 span 標記
        // 避免重複標記已經有 highlight 的文字
        const regex = new RegExp(`(?![^<]*>)(${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g');
        const newHTML = innerHTML.replace(regex, (match) => {
            return `<span class="highlight-${type}">${match}</span>`;
        });

        container.innerHTML = newHTML;
    };

    const toggleEsgType = (type) => setEsgTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);

    useEffect(() => { if (promiseStatus === 'No') { setVerificationTimeline('N/A'); setEvidenceStatus('N/A'); } }, [promiseStatus]);
    useEffect(() => { if (evidenceStatus !== 'Yes') setEvidenceQuality('N/A'); }, [evidenceStatus]);

return (
        <div className="container">
            <div className="header">
                <h1>{project.name} - 標註工具</h1>
                <div className="controls">
                    <button onClick={onBack} className="btn">返回專案列表</button>
                    {user.role === 'admin' && (
                        <button onClick={handleBatchAutoAlign} disabled={!!batchAlignProgress && !batchAlignProgress.completed} className="btn" style={{ background: '#8b5cf6', color: 'white', marginLeft: '10px' }}>
                            🤖 批次自動對齊
                        </button>
                    )}
                    {user.role === 'admin' && (
                        <button onClick={handleAutoFixUrlMismatch} className="btn" style={{ background: '#10b981', color: 'white', marginLeft: '10px' }}>
                            🔗 修復 URL 不匹配
                        </button>
                    )}
                    <button onClick={handleValidateData} className="btn" style={{ background: '#3b82f6', color: 'white', marginLeft: '10px' }}>
                        ✓ 驗證資料完整性
                    </button>
                    <button onClick={handleResetProject} className="btn" style={{ background: '#dc2626', color: 'white', marginLeft: '10px' }}>
                        🔄 重置專案
                    </button>
                    <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>標註者: {user.username}</span>
                </div>
                {/* --- 按鈕與參考資料 --- */}
                <div className="progress" style={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    flexWrap: 'wrap', 
                    gap: '15px',
                    marginTop: '15px',
                    paddingTop: '15px',
                    borderTop: '1px solid #e5e7eb' // 增加一條分隔線讓區塊更明顯
                }}>
                    
                    {/* 左側：個人進度 & 跳轉選單 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                        <div style={{ fontSize: '14px', color: '#4b5563', fontWeight: '500' }}>
                            您的個人進度: {progress.completed} / {progress.total}
                            {skippedCount > 0 && (
                                <span style={{ color: '#f59e0b', fontWeight: 'bold', marginLeft: '8px' }}>
                                    ⚠️ {skippedCount} 待補
                                </span>
                            )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ whiteSpace: 'nowrap', fontSize: '14px', color: '#374151' }}>跳到第幾筆:</span>
                            <select 
                                value={selectedSequence} 
                                onChange={handleSequenceJump} 
                                style={{ 
                                    padding: '6px 10px', 
                                    border: '1px solid #d1d5db', 
                                    borderRadius: '4px', 
                                    minWidth: '180px', 
                                    fontSize: '14px' 
                                }}
                            >
                                <option value="">請選擇...</option>
                                {allTasks.map((task) => {
                                    let status = '', color = '';
                                    let isIncomplete = false;
                                    if (validationResult && task.status === 'completed') {
                                        isIncomplete = validationResult.invalidTasks.some(invTask => invTask.sequence === task.sequence);
                                    }
                                    if (task.skipped === true) { status = '[待補]'; color = '#fef3c7'; }
                                    else if (isIncomplete) { status = '[不完整]'; color = '#fecaca'; }
                                    else if (task.status === 'completed') { status = '[完成]'; color = '#d1fae5'; }
                                    else { status = '[未填]'; color = '#ffffff'; }

                                    const markPrefix = task.is_marked ? '⭐ ' : '';
                                    
                                    return <option key={task.id} value={task.sequence} style={{ backgroundColor: color }}>
                                        {markPrefix}{status} 第 {task.sequence} 筆 (頁碼: {task.page_number})
                                    </option>;
                                })}
                            </select>
                        </div>
                    </div>

                    {/* 右側：按鈕群組 & 參考資源 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                        
                        {/* 1. 操作按鈕區 */}
                        <div className="nav-btns" style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="btn"
                                onClick={onShowOverview}
                                title="查看所有資料總覽"
                                style={{ background: '#6366f1', color: 'white', padding: '8px 12px', fontSize: '14px', fontWeight: 'bold' }}
                            >
                                所有資料
                            </button>
                            
                            <button
                                className="btn"
                                onClick={handleToggleMark}
                                disabled={!currentItem}
                                title={isMarked ? "取消標記" : "標記此題"}
                                style={{
                                    background: isMarked ? '#ec4899' : '#e5e7eb',
                                    color: isMarked ? 'white' : '#6b7280',
                                    fontSize: '18px',
                                    padding: '8px 12px',
                                    transition: 'all 0.2s',
                                    minWidth: '44px'
                                }}
                            >
                                {isMarked ? '★' : '☆'}
                            </button>

                            <button
                                className="btn"
                                onClick={loadPreviousTask}
                                disabled={progress.completed === 0}
                                style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }}
                            >
                                ← 上一筆
                            </button>

                            <button
                                className="btn"
                                onClick={handleSkip}
                                disabled={!currentItem}
                                style={{ background: '#f59e0b', color: 'white' }}
                            >
                                ⏭️ 跳過
                            </button>

                            <button
                                className="nav-btn btn-emerald"
                                onClick={handleSaveAndNext}
                                disabled={!currentItem}
                            >
                                儲存 & 下一筆
                            </button>
                        </div>

                        {/* 2. 參考資源 (加上左側分隔線) */}
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '12px', 
                            borderLeft: '1px solid #d1d5db', 
                            paddingLeft: '15px',
                            marginLeft: '5px',
                            height: '30px' // 固定高度以確保垂直置中漂亮
                        }}>
                            <span style={{ fontWeight: 'bold', color: '#4b5563', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                📚 參考資源:
                            </span>
                            <a href="https://hackmd.io/@wesley12345/H14L7CWAxe#AI-CUP-%E6%A8%99%E8%A8%BB%E6%89%8B%E5%86%8A" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '500' }}>
                                📖 標註手冊 V2
                            </a>
                            <span style={{ color: '#cbd5e1' }}>|</span>
                            <a href="https://docs.google.com/presentation/d/1px_pWnWi67JQEfLa448btzWxGLlSiQPvpDMHDbXtbm8/edit?usp=sharing" target="_blank" rel="noopener noreferrer" style={{ color: '#ea580c', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '500' }}>
                                📊 教學影片
                            </a>
                        </div>
                    </div>
                </div>

                {/* 批次對齊進度顯示 */}
                {batchAlignProgress && (
                    <div style={{
                        background: batchAlignProgress.completed ? '#d1fae5' : '#fef3c7',
                        border: `2px solid ${batchAlignProgress.completed ? '#10b981' : '#f59e0b'}`,
                        borderRadius: '8px',
                        padding: '15px',
                        marginTop: '15px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <strong style={{ fontSize: '16px' }}>
                                {batchAlignProgress.completed ? '✓ 批次對齊完成' : '🤖 批次對齊進行中...'}
                            </strong>
                            {batchAlignProgress.completed && (
                                <button
                                    onClick={() => setBatchAlignProgress(null)}
                                    style={{
                                        background: '#6b7280',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '4px',
                                        padding: '5px 10px',
                                        cursor: 'pointer',
                                        fontSize: '12px'
                                    }}
                                >
                                    關閉
                                </button>
                            )}
                        </div>
                        <div style={{ fontSize: '14px', marginBottom: '10px' }}>
                            {batchAlignProgress.status}
                        </div>
                        <div style={{ display: 'flex', gap: '20px', fontSize: '13px', marginBottom: '10px' }}>
                            <span>進度：{batchAlignProgress.current} / {batchAlignProgress.total}</span>
                            <span style={{ color: '#10b981' }}>✓ 已調整：{batchAlignProgress.alignedCount}</span>
                            <span style={{ color: '#6b7280' }}>○ 跳過：{batchAlignProgress.skippedCount}</span>
                            {batchAlignProgress.errorCount > 0 && (
                                <span style={{ color: '#dc2626' }}>✗ 錯誤：{batchAlignProgress.errorCount}</span>
                            )}
                        </div>
                        {!batchAlignProgress.completed && batchAlignProgress.total > 0 && (
                            <div style={{ background: '#e5e7eb', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                                <div style={{
                                    width: `${(batchAlignProgress.current / batchAlignProgress.total) * 100}%`,
                                    background: '#8b5cf6',
                                    height: '100%',
                                    transition: 'width 0.3s'
                                }}></div>
                            </div>
                        )}
                        {batchAlignProgress.completed && batchAlignProgress.details && batchAlignProgress.details.length > 0 && (
                            <details style={{ marginTop: '10px', fontSize: '12px' }}>
                                <summary style={{ cursor: 'pointer', fontWeight: 'bold' }}>
                                    查看調整詳情 ({batchAlignProgress.details.length} 筆)
                                </summary>
                                <div style={{ marginTop: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                                    {batchAlignProgress.details.map((detail, idx) => (
                                        <div key={idx} style={{ padding: '5px 0', borderBottom: '1px solid #e5e7eb' }}>
                                            資料 ID {detail.id}: 第 {detail.oldPage} 頁 → 第 {detail.newPage} 頁 (相似度: {detail.similarity}%)
                                        </div>
                                    ))}
                                </div>
                            </details>
                        )}
                    </div>
                )}
            </div>

            {currentItem === undefined && <div className="panel"><h2>讀取中...</h2></div>}
            {currentItem === null && progress.completed + skippedCount >= progress.total && progress.total > 0 && (
                <div className="panel">
                    <h2>🎉 恭喜！您已完成此專案的所有標註！</h2>
                    <p style={{ marginTop: '20px', fontSize: '16px', color: '#666' }}>
                        請點擊「<strong style={{ color: '#3b82f6' }}>✓ 驗證資料完整性</strong>」按鈕確保所有資料都是完整的。
                    </p>
                    <p style={{ marginTop: '10px', fontSize: '16px', color: '#666' }}>
                        您也可以點擊「← 上一筆」按鈕返回查看或修改已標註的項目。
                    </p>
                </div>
            )}
            {currentItem === null && !(progress.completed + skippedCount >= progress.total && progress.total > 0) && (
                <div className="panel">
                    <h2>📝 已完成當前可見範圍</h2>
                    <p style={{ marginTop: '20px', fontSize: '16px', color: '#666' }}>
                        您的進度：{progress.completed + skippedCount} / {progress.total}
                    </p>
                    <p style={{ marginTop: '10px', fontSize: '16px', color: '#666' }}>
                        目前沒有更多可標註的資料。
                    </p>
                    <p style={{ marginTop: '10px', fontSize: '16px', color: '#888', fontSize: '14px' }}>
                        💡 這可能是因為：
                    </p>
                    <ul style={{ marginTop: '5px', marginLeft: '20px', color: '#888', fontSize: '14px' }}>
                        <li>您已完成分配給您的所有資料</li>
                        <li>這是合併專案，其他資料由其他成員負責</li>
                        <li>還有資料尚未開始標註（可使用跳到第幾筆功能查看）</li>
                    </ul>
                    <p style={{ marginTop: '15px', fontSize: '16px', color: '#666' }}>
                        您可以點擊「<strong style={{ color: '#3b82f6' }}>← 上一筆</strong>」按鈕返回查看或修改已標註的項目。
                    </p>
                </div>
            )}
            {currentItem && (
                <div className="content">
                    <div className="content-top">
                        <div className="panel">
                            <h2>文本內容 (ID: {currentItem.id}, 頁碼: {currentItem.page_number})</h2>
                            <div className="info-box">用滑鼠選取文字後點擊下方按鈕: 黃色=承諾 / 藍色=證據 / 清除標記=橡皮擦（只清除選取的標記）</div>
                            <div ref={dataTextRef} className="text-area"></div>
                            <div className="highlight-btns">
                                <button className="highlight-btn highlight-btn-promise" onClick={() => highlightSelection('promise')}>標記承諾</button>
                                <button className="highlight-btn highlight-btn-evidence" onClick={() => highlightSelection('evidence')}>標記證據</button>
                                <button className="highlight-btn highlight-btn-clear" onClick={clearSelectedHighlights}>清除標記</button>
                            </div>
                        </div>
                        <div className="panel">
                            <h2>標註欄位</h2>

                            {/* 顯示不完整提示 */}
                            {(() => {
                                const issues = checkCurrentItemCompleteness();
                                if (issues && issues.length > 0) {
                                    return (
                                        <div style={{
                                            background: '#fecaca',
                                            border: '2px solid #ef4444',
                                            borderRadius: '8px',
                                            padding: '12px',
                                            marginBottom: '15px'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'start' }}>
                                                <span style={{ fontSize: '18px', marginRight: '8px' }}>⚠️</span>
                                                <div>
                                                    <strong style={{ color: '#991b1b', fontSize: '14px' }}>此筆資料不完整</strong>
                                                    <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px', fontSize: '13px', color: '#7f1d1d' }}>
                                                        {issues.map((issue, idx) => (
                                                            <li key={idx}>{issue}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                }
                                return null;
                            })()}

                            <div className="field">
                                <label>ESG 類型</label>
                                <div className="checkbox-group">
                                    <button className={`checkbox-btn ${esgTypes.includes('E') ? 'active' : ''}`} onClick={() => toggleEsgType('E')}>E</button>
                                    <button className={`checkbox-btn ${esgTypes.includes('S') ? 'active' : ''}`} onClick={() => toggleEsgType('S')}>S</button>
                                    <button className={`checkbox-btn ${esgTypes.includes('G') ? 'active' : ''}`} onClick={() => toggleEsgType('G')}>G</button>
                                </div>
                            </div>
                            <div className="field">
                                <label title="判斷企業是否提出「未來導向」的目標或行動（Yes/No）。會對應到驗證時間軸。例如：「我們已經導入新風險管理系統」→ Yes + already；「我們將在 2030 年達到 50% 再生能源比例」→ Yes + more_than_5_years" style={{ cursor: 'help' }}>
                                    承諾狀態 ⓘ
                                </label>
                                <select value={promiseStatus} onChange={e => setPromiseStatus(e.target.value)}>
                                    <option value="">請選擇</option>
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                            {promiseStatus === 'Yes' && (
                                <>
                                    <div className="field">
                                        <label title="判斷承諾需多久才能被驗證。within_2_years: 2年內、between_2_and_5_years: 2-5年、longer_than_5_years: 5年以上、already: 已執行/已完成" style={{ cursor: 'help' }}>
                                            驗證時間軸 ⓘ
                                        </label>
                                        <select value={verificationTimeline} onChange={e => setVerificationTimeline(e.target.value)}>
                                            <option value="">請選擇</option>
                                            <option value="within_2_years">2年內</option>
                                            <option value="between_2_and_5_years">2-5年</option>
                                            <option value="longer_than_5_years">5年以上</option>
                                            <option value="already">已執行</option>
                                        </select>
                                    </div>
                                    <div className="field">
                                        <label title="是否存在支持承諾的具體內容（數據、案例、措施等）。表格中的數據通常視為證據。" style={{ cursor: 'help' }}>
                                            證據狀態 ⓘ
                                        </label>
                                        <select value={evidenceStatus} onChange={e => setEvidenceStatus(e.target.value)}>
                                            <option value="">請選擇</option>
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                        </select>
                                    </div>
                                    {evidenceStatus === 'Yes' && (
                                        <div className="field">
                                            <label title="評估證據是否充足、清楚並與承諾直接相關。Clear: 證據具體清晰且與承諾直接相關；Not Clear: 證據模糊或僅部分相關；Misleading: 證據與承諾關聯弱或轉移焦點" style={{ cursor: 'help' }}>
                                                證據品質 ⓘ
                                            </label>
                                            <select value={evidenceQuality} onChange={e => setEvidenceQuality(e.target.value)}>
                                                <option value="">請選擇</option>
                                                <option value="Clear">清晰</option>
                                                <option value="Not Clear">不清晰</option>
                                                <option value="Misleading">誤導性</option>
                                            </select>
                                        </div>
                                    )}
                                </>
                            )}
                            {promiseStatus === 'No' && (
                                <>
                                    <div className="field">
                                        <label title="判斷承諾需多久才能被驗證。within_2_years: 2年內、between_2_and_5_years: 2-5年、longer_than_5_years: 5年以上、already: 已執行/已完成" style={{ cursor: 'help' }}>
                                            驗證時間軸 ⓘ
                                        </label>
                                        <input type="text" value="N/A" disabled style={{ background: '#f3f4f6', color: '#6b7280' }} />
                                    </div>
                                    <div className="field">
                                        <label title="是否存在支持承諾的具體內容（數據、案例、措施等）。表格中的數據通常視為證據。" style={{ cursor: 'help' }}>
                                            證據狀態 ⓘ
                                        </label>
                                        <input type="text" value="N/A" disabled style={{ background: '#f3f4f6', color: '#6b7280' }} />
                                    </div>
                                    <div className="field">
                                        <label title="評估證據是否充足、清楚並與承諾直接相關（Clear: 清晰、Misleading: 誤導性、Not Clear: 不清晰）" style={{ cursor: 'help', borderBottom: '1px dotted #666' }}>
                                            證據品質 ⓘ
                                        </label>
                                        <input type="text" value="N/A" disabled style={{ background: '#f3f4f6', color: '#6b7280' }} />
                                    </div>
                                </>
                            )}
                            {promiseStatus === 'Yes' && evidenceStatus === 'No' && (
                                <div className="field">
                                    <label title="評估證據是否充足、清楚並與承諾直接相關（Clear: 清晰、Misleading: 誤導性、Not Clear: 不清晰）" style={{ cursor: 'help', borderBottom: '1px dotted #666' }}>
                                        證據品質 ⓘ
                                    </label>
                                    <input type="text" value="N/A" disabled style={{ background: '#f3f4f6', color: '#6b7280' }} />
                                </div>
                            )}
                        </div>
                    </div>
                     <div className="panel">
                       <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                         <h3 style={{ margin: 0 }}>PDF 文件</h3>
                         {user.role === 'admin' && (
                           <button
                             onClick={() => setShowPageAdjust(!showPageAdjust)}
                             className="btn"
                             style={{
                               background: '#f59e0b',
                               color: 'white',
                               padding: '5px 10px',
                               fontSize: '12px'
                             }}
                           >
                             {showPageAdjust ? '取消調整' : '🔧 調整頁碼'}
                           </button>
                         )}
                       </div>

                       {showPageAdjust && user.role === 'admin' && (
                         <div style={{
                           background: '#fef3c7',
                           border: '2px solid #f59e0b',
                           borderRadius: '8px',
                           padding: '15px',
                           marginBottom: '15px'
                         }}>
                           <div style={{ marginBottom: '10px' }}>
                             <strong>當前頁碼：</strong>{currentItem.page_number}
                           </div>
                           <div style={{ marginBottom: '10px' }}>
                             <strong>資料 ID：</strong>{currentItem.id}
                           </div>

                           {/* 自動對齊按鈕 */}
                           <div style={{ marginBottom: '15px' }}>
                             <button
                               onClick={handleAutoAlign}
                               disabled={!!autoAlignProgress}
                               className="btn"
                               style={{
                                 background: '#3b82f6',
                                 color: 'white',
                                 padding: '8px 15px',
                                 width: '100%',
                                 fontSize: '14px'
                               }}
                             >
                               {autoAlignProgress ? '分析中...' : '🔍 自動尋找正確頁碼'}
                             </button>
                           </div>

                           {/* 進度顯示 */}
                           {autoAlignProgress && (
                             <div style={{
                               background: '#dbeafe',
                               border: '1px solid #3b82f6',
                               borderRadius: '4px',
                               padding: '10px',
                               marginBottom: '15px'
                             }}>
                               <div style={{ fontSize: '13px', marginBottom: '5px' }}>
                                 {autoAlignProgress.status}
                               </div>
                               <div style={{ fontSize: '12px', color: '#1e40af' }}>
                                 進度：{autoAlignProgress.current} / {autoAlignProgress.total}
                               </div>
                             </div>
                           )}

                           {/* 建議結果 */}
                           {suggestedPage && (
                             <div style={{
                               background: '#d1fae5',
                               border: '2px solid #10b981',
                               borderRadius: '4px',
                               padding: '10px',
                               marginBottom: '15px'
                             }}>
                               <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '5px' }}>
                                 ✓ 建議頁碼：第 {suggestedPage.pageNumber} 頁
                               </div>
                               <div style={{ fontSize: '12px', color: '#065f46' }}>
                                 相似度：{suggestedPage.similarity.toFixed(1)}%
                               </div>
                             </div>
                           )}

                           <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                             <label style={{ whiteSpace: 'nowrap' }}>調整為頁碼：</label>
                             <input
                               type="number"
                               min="1"
                               value={newPageNumber}
                               onChange={(e) => setNewPageNumber(e.target.value)}
                               placeholder="輸入新頁碼"
                               style={{
                                 padding: '5px 10px',
                                 border: '1px solid #ccc',
                                 borderRadius: '4px',
                                 width: '100px'
                               }}
                             />
                             <button
                               onClick={handlePageNumberAdjust}
                               className="btn"
                               style={{
                                 background: '#10b981',
                                 color: 'white',
                                 padding: '5px 15px'
                               }}
                             >
                               確認調整
                             </button>
                           </div>
                           <div style={{ marginTop: '10px', fontSize: '12px', color: '#92400e' }}>
                             ⚠️ 注意：調整頁碼會同時更新 PDF URL，請確認新頁碼正確
                           </div>
                         </div>
                       )}

                       <PDFViewer
                           pdfUrl={currentItem.source_url}
                           pageNumber={currentItem.page_number}
                           bbox={currentItem.bbox}
                       />
                    </div>
                </div>
            )}
        </div>
    );
}

export default function HomePage() {
  const [user, setUser] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);

  // 控制是否顯示總覽頁面
  const [showOverview, setShowOverview] = useState(false); 
  // 暫存要跳轉的題號 (從總覽頁點回來時用)
  const [jumpToSequence, setJumpToSequence] = useState(null);

useEffect(() => {
    try {
      const savedUser = localStorage.getItem('annotatorUser');
      if (savedUser) {
        setUser(JSON.parse(savedUser));
      }
    } catch (e) {
        localStorage.removeItem('annotatorUser');
    }
  }, []);

  const handleLoginSuccess = (loggedInUser) => {
    localStorage.setItem('annotatorUser', JSON.stringify(loggedInUser));
    setUser(loggedInUser);
  };

  const handleLogout = () => {
      localStorage.removeItem('annotatorUser');
      setUser(null);
      setSelectedProject(null);
  };

  if (!user) {
    return <LoginRegisterScreen onLoginSuccess={handleLoginSuccess} />;
  }
  
  if (!selectedProject) {
    return <ProjectSelectionScreen user={user} onProjectSelect={setSelectedProject} onLogout={handleLogout} />;
  }

  // --- 顯示總覽頁面邏輯 ---
  if (showOverview) {
      return (
          <AllTasksOverviewScreen 
              user={user} 
              project={selectedProject} 
              onBack={() => setShowOverview(false)}
              onJumpToTask={(seq) => {
                  setJumpToSequence(seq); // 設定要跳轉的題號
                  setShowOverview(false); // 關閉總覽，回到標註頁
              }}
          />
      );
  }

  return (
      <AnnotationScreen 
          user={user} 
          project={selectedProject} 
          onBack={() => setSelectedProject(null)} 
          onShowOverview={() => setShowOverview(true)} // 傳遞切換函式
          initialSequence={jumpToSequence} // 傳遞跳轉目標
          onJumpConsumed={() => setJumpToSequence(null)} // 清除跳轉目標
      />
  );
}