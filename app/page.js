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
  resetProjectAnnotations,
  saveAnnotation
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
  useEffect(() => {
    async function fetchProjects() {
      const { projects, error } = await getProjectsWithProgress(user.id);
      if (error) alert(error);
      else setProjects(projects);
    }
    fetchProjects();
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
        if (proj) setProgress({ completed: proj.completed_tasks, total: proj.total_tasks });
    };

    const loadPreviousTask = async () => {
        if (!currentItem) return;
        const res = await getPreviousTaskForUser(project.id, user.id, currentItem.id);
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
        if (promiseStatus === 'Yes') {
            if (!verificationTimeline) return alert('請選擇驗證時間軸');
            if (!evidenceStatus) return alert('請選擇證據狀態');
            if (evidenceStatus === 'Yes' && !evidenceQuality) return alert('請選擇證據品質');
        }

        const annotationData = {
            source_data_id: currentItem.id,
            user_id: user.id,
            esg_type: esgTypes.join(','),
            promise_status: promiseStatus,
            promise_string: getHighlightedText('promise'),
            verification_timeline: verificationTimeline,
            evidence_status: evidenceStatus,
            evidence_string: getHighlightedText('evidence'),
            evidence_quality: evidenceQuality
        };

        const result = await saveAnnotation(annotationData);
        if (!result.success) {
            alert(`儲存失敗: ${result.error}`);
            return;
        }

        clearAllHighlights();
        setEsgTypes([]);
        setPromiseStatus('');
        setVerificationTimeline('');
        setEvidenceStatus('');
        setEvidenceQuality('');
        
        await loadTask();
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
    
    const clearAllHighlights = () => {
        if (dataTextRef.current && currentItem) {
            dataTextRef.current.innerHTML = currentItem.original_data;
        }
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
                    <span>您的個人進度: {progress.completed} / {progress.total}</span>
                    <div className="nav-btns">
                        <button 
                            className="btn"
                            onClick={loadPreviousTask}
                            disabled={!currentItem}
                            style={{marginRight: '10px'}}
                        >
                            ← 上一筆
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
            {currentItem === null && <div className="panel"><h2>恭喜！您已完成此專案的所有標註！</h2></div>}
            {currentItem && (
                <div className="content">
                    <div className="content-top">
                        <div className="panel">
                            <h2>文本內容 (ID: {currentItem.id}, 頁碼: {currentItem.page_number})</h2>
                            <div className="info-box">用滑鼠選取文字後點擊下方按鈕: 黃色=承諾 / 藍色=證據</div>
                            <div ref={dataTextRef} className="text-area"></div>
                            <div className="highlight-btns">
                                <button className="highlight-btn highlight-btn-promise" onClick={() => highlightSelection('promise')}>標記承諾</button>
                                <button className="highlight-btn highlight-btn-evidence" onClick={() => highlightSelection('evidence')}>標記證據</button>
                                <button className="highlight-btn highlight-btn-clear" onClick={clearAllHighlights}>清除標記</button>
                            </div>
                        </div>
                        <div className="panel">
                            <h2>標註欄位</h2>
                            <div className="field">
                                <label>ESG 類型</label>
                                <div className="checkbox-group">
                                    <button className={`checkbox-btn ${esgTypes.includes('E') ? 'active' : ''}`} onClick={() => toggleEsgType('E')}>E</button>
                                    <button className={`checkbox-btn ${esgTypes.includes('S') ? 'active' : ''}`} onClick={() => toggleEsgType('S')}>S</button>
                                    <button className={`checkbox-btn ${esgTypes.includes('G') ? 'active' : ''}`} onClick={() => toggleEsgType('G')}>G</button>
                                </div>
                            </div>
                            <div className="field">
                                <label>承諾狀態</label>
                                <select value={promiseStatus} onChange={e => setPromiseStatus(e.target.value)}>
                                    <option value="">請選擇</option>
                                    <option value="Yes">Yes</option>
                                    <option value="No">No</option>
                                </select>
                            </div>
                            {promiseStatus === 'Yes' && (
                                <>
                                    <div className="field">
                                        <label>驗證時間軸</label>
                                        <select value={verificationTimeline} onChange={e => setVerificationTimeline(e.target.value)}>
                                            <option value="">請選擇</option>
                                            <option value="within_2_years">2年內</option>
                                            <option value="between_2_and_5_years">2-5年</option>
                                            <option value="longer_than_5_years">5年以上</option>
                                            <option value="already">已執行</option>
                                            <option value="N/A">N/A</option>
                                        </select>
                                    </div>
                                    <div className="field">
                                        <label>證據狀態</label>
                                        <select value={evidenceStatus} onChange={e => setEvidenceStatus(e.target.value)}>
                                            <option value="">請選擇</option>
                                            <option value="Yes">Yes</option>
                                            <option value="No">No</option>
                                            <option value="N/A">N/A</option>
                                        </select>
                                    </div>
                                    {evidenceStatus === 'Yes' && (
                                        <div className="field">
                                            <label>證據品質</label>
                                            <select value={evidenceQuality} onChange={e => setEvidenceQuality(e.target.value)}>
                                                <option value="">請選擇</option>
                                                <option value="Clear">清晰</option>
                                                <option value="Not Clear">不清晰</option>
                                                <option value="Misleading">誤導性</option>
                                                <option value="N/A">N/A</option>
                                            </select>
                                        </div>
                                    )}
                                </>
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