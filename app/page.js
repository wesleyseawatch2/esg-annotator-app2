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
  getActiveAnnouncements
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
    setMessage('處理中...');
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

  return (
    <div className="modal" style={{ display: 'block' }}>
      <div className="modal-content">
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <img src="/ntpu-logo.png" alt="國立臺北大學" style={{ maxWidth: '300px', height: 'auto' }} />
        </div>
        <h2>{isLogin ? '登入' : '註冊'}</h2>
        <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="使用者名稱" />
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="密碼" />
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

    fetchProjects();
    fetchAnnouncements();
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
            <div>
              {user.role === 'admin' && (
                <Link href="/admin" className="btn btn-purple" style={{marginRight: '10px'}}>
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

function AnnotationScreen({ user, project, onBack }) {
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
    const [validationResult, setValidationResult] = useState(null);
    const dataTextRef = useRef(null);

    useEffect(() => { loadTask(); }, []);

    useEffect(() => {
        if (currentItem && dataTextRef.current) {
            // 如果有已儲存的標註資料，恢復高亮；否則只顯示原始文本
            if (currentItem.promise_string || currentItem.evidence_string) {
                restoreHighlights(currentItem);
            } else {
                dataTextRef.current.innerHTML = currentItem.original_data;
            }
        } else if (currentItem === null) {
            // 當完成所有標註時，自動執行驗證
            handleValidateData();
        }
    }, [currentItem]);

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
            setProgress({ completed: proj.completed_tasks, total: proj.total_tasks });
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

        // 恢復高亮標記
        if (dataTextRef.current) {
            restoreHighlights(task);
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
        if (proj) setProgress({ completed: proj.completed_tasks, total: proj.total_tasks });

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

        // 載入下一筆
        const nextRes = await getNextTaskAfterCurrent(project.id, user.id, currentItem.id);
        if (nextRes.task) {
            setCurrentItem(nextRes.task);
            loadTaskData(nextRes.task);
        } else {
            setCurrentItem(null);
        }

        // 更新進度和任務列表
        const projRes = await getProjectsWithProgress(user.id);
        const proj = projRes.projects?.find(p => p.id === project.id);
        if (proj) setProgress({ completed: proj.completed_tasks, total: proj.total_tasks });

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
            const passMessage = [
                '✅ 驗證通過！',
                '',
                `📊 統計資料：`,
                `• 已完成標註：${result.totalCompleted} 筆`,
                `• 不完整資料：0 筆`,
                `• 待補資料：${skippedCount} 筆`,
                '',
                '✨ 所有已完成的標註資料都符合要求！'
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

            const summaryMessage = [
                '⚠️ 發現不完整的資料',
                '',
                `📊 統計資料：`,
                `• 已完成標註：${result.totalCompleted} 筆`,
                `• 不完整資料：${result.invalidCount} 筆`,
                ...statsLines,
                `• 待補資料：${skippedCount} 筆`,
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
        return Array.from(dataTextRef.current.querySelectorAll(`.highlight-${type}`))
            .map(el => el.textContent.trim())
            .join(' ');
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

        // 恢復承諾高亮
        if (task.promise_string) {
            const promiseTexts = task.promise_string.split(' ').filter(t => t.trim());
            promiseTexts.forEach(text => {
                highlightTextInContent(text.trim(), 'promise');
            });
        }

        // 恢復證據高亮
        if (task.evidence_string) {
            const evidenceTexts = task.evidence_string.split(' ').filter(t => t.trim());
            evidenceTexts.forEach(text => {
                highlightTextInContent(text.trim(), 'evidence');
            });
        }
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
                    <button
                        onClick={handleValidateData}
                        className="btn"
                        style={{
                            background: '#3b82f6',
                            color: 'white',
                            marginLeft: '10px'
                        }}
                    >
                        ✓ 驗證資料完整性
                    </button>
                    <button
                        onClick={handleResetProject}
                        className="btn"
                        style={{
                            background: '#dc2626',
                            color: 'white',
                            marginLeft: '10px'
                        }}
                    >
                        🔄 重置專案
                    </button>
                    <span style={{ marginLeft: 'auto', fontWeight: 'bold' }}>標註者: {user.username}</span>
                </div>
                <div className="progress">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                        <span>您的個人進度: {progress.completed} / {progress.total}</span>
                        {skippedCount > 0 && (
                            <span style={{ color: '#f59e0b', fontWeight: 'bold', fontSize: '14px' }}>
                                ⚠️ {skippedCount} 個待補項目
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '10px' }}>
                        <span style={{ whiteSpace: 'nowrap' }}>跳到第幾筆:</span>
                        <select
                            value={selectedSequence}
                            onChange={handleSequenceJump}
                            style={{
                                padding: '5px 10px',
                                border: '1px solid #ccc',
                                borderRadius: '4px',
                                minWidth: '200px',
                                fontSize: '14px'
                            }}
                        >
                            <option value="">請選擇...</option>
                            {allTasks.map((task) => {
                                let status = '';
                                let color = '';

                                // 使用驗證結果判斷是否不完整
                                let isIncomplete = false;
                                if (validationResult && task.status === 'completed') {
                                    // 在驗證結果中找到對應的不完整任務
                                    isIncomplete = validationResult.invalidTasks.some(
                                        invTask => invTask.sequence === task.sequence
                                    );
                                }

                                if (task.skipped === true) {
                                    status = '🟡 [待補]';
                                    color = '#fef3c7';
                                } else if (isIncomplete) {
                                    status = '🔴 [不完整]';
                                    color = '#fecaca';
                                } else if (task.status === 'completed') {
                                    status = '🟢 [完成]';
                                    color = '#d1fae5';
                                } else {
                                    status = '⚪ [未填]';
                                    color = '#ffffff';
                                }
                                return (
                                    <option
                                        key={task.id}
                                        value={task.sequence}
                                        style={{ backgroundColor: color }}
                                    >
                                        {status} 第 {task.sequence} 筆 (頁碼: {task.page_number})
                                    </option>
                                );
                            })}
                        </select>
                    </div>
                    <div className="nav-btns">
                        <button
                            className="btn"
                            onClick={loadPreviousTask}
                            disabled={progress.completed === 0}
                            style={{marginRight: '10px'}}
                        >
                            ← 上一筆
                        </button>
                        <button
                            className="btn"
                            onClick={handleSkip}
                            disabled={!currentItem}
                            style={{
                                marginRight: '10px',
                                background: '#f59e0b',
                                color: 'white'
                            }}
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
                </div>
            </div>

            {currentItem === undefined && <div className="panel"><h2>讀取中...</h2></div>}
            {currentItem === null && (
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

  return <AnnotationScreen user={user} project={selectedProject} onBack={() => setSelectedProject(null)} />;
}