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
  getLocalAnnouncements,
  updateSourceDataPageNumber,
  toggleAnnotationMark,
  getProjectTasksOverview,
  getReannotationHistory
} from './actions';
import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('../components/PDFViewer'), {
  ssr: false,
  loading: () => <div className="pdf-status">正在載入 PDF 瀏覽器...</div>
});

// --- 簡單的 Markdown 渲染器 (支援標題、列表、粗體、連結) ---
function SimpleMarkdown({ content }) {
    if (!content) return null;
    
    // 將文本按行分割
    const lines = content.split('\n');
    
    return (
        <div style={{ lineHeight: '1.6', fontSize: '15px', color: '#374151' }}>
            {lines.map((line, idx) => {
                // 處理標題 (# Title)
                if (line.trim().startsWith('#')) {
                    const level = line.match(/^#+/)[0].length;
                    const text = line.replace(/^#+\s*/, '');
                    const fontSize = level === 1 ? '1.5em' : level === 2 ? '1.25em' : '1.1em';
                    return <div key={idx} style={{ fontWeight: 'bold', fontSize, marginTop: '12px', marginBottom: '6px', color: '#111827' }}>{text}</div>;
                }
                // 處理列表 (- Item)
                if (line.trim().startsWith('- ')) {
                    const text = line.trim().substring(2);
                    return (
                        <div key={idx} style={{ display: 'flex', alignItems: 'start', marginLeft: '10px', marginBottom: '4px' }}>
                            <span style={{ marginRight: '8px', color: '#6b7280' }}>•</span>
                            <span>{parseInlineStyles(text)}</span>
                        </div>
                    );
                }
                // 處理有序列表 (1. Item)
                if (/^\d+\.\s/.test(line.trim())) {
                     return (
                        <div key={idx} style={{ marginLeft: '10px', marginBottom: '4px' }}>
                            {parseInlineStyles(line.trim())}
                        </div>
                    );
                }
                // 空行
                if (!line.trim()) return <div key={idx} style={{ height: '8px' }}></div>;
                
                // 一般段落
                return <div key={idx} style={{ marginBottom: '4px' }}>{parseInlineStyles(line)}</div>;
            })}
        </div>
    );
}

// 輔助函式：處理行內樣式
function parseInlineStyles(text) {
    const elements = [];
    let remaining = text;
    let key = 0;

    const regex = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/;

    while (remaining.length > 0) {
        const match = remaining.match(regex);
        if (!match) {
            elements.push(<span key={key++}>{remaining}</span>);
            break;
        }
        // match 前的普通文字
        if (match.index > 0) {
            elements.push(
                <span key={key++}>{remaining.slice(0, match.index)}</span>
            );
        }
        // **粗體**
        if (match[1]) {
            elements.push(
                <strong key={key++}>{match[2]}</strong>
            );
        }
        // [連結](url)
        if (match[3]) {
            elements.push(
                <a
                    key={key++}
                    href={match[5]}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#2563eb', textDecoration: 'underline' }}
                >
                    {match[4]}
                </a>
            );
        }
        remaining = remaining.slice(match.index + match[0].length);
    }
    return elements;
}

// --- 公告彈窗元件 ---
function AnnouncementModal({ isOpen, onClose, announcements, readIds, onMarkAsRead, loading }) {
    // 監聽 ESC 鍵關閉
    useEffect(() => {
        const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
        if (isOpen) window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    // [安全防護] 確保 readIds 是一個陣列，避免 undefined 錯誤
    const safeReadIds = Array.isArray(readIds) ? readIds : [];

    return (
        <div 
            style={{ 
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, 
                backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999,
                display: 'flex', justifyContent: 'center', alignItems: 'center',
                padding: '20px', backdropFilter: 'blur(2px)'
            }}
            onClick={onClose} // 點擊背景關閉
        >
            <div 
                style={{ 
                    backgroundColor: 'white', width: '100%', maxWidth: '700px', 
                    maxHeight: '85vh', borderRadius: '12px', 
                    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden'
                }}
                onClick={e => e.stopPropagation()} // 點擊內容不關閉
            >
                {/* 彈窗標題列 */}
                <div style={{ 
                    padding: '20px', borderBottom: '1px solid #e5e7eb', 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: '#f9fafb'
                }}>
                    <h2 style={{ margin: 0, fontSize: '20px', color: '#1f2937' }}>📢 系統公告</h2>
                    <button 
                        onClick={onClose}
                        style={{ 
                            background: 'transparent', border: 'none', fontSize: '24px', 
                            color: '#6b7280', cursor: 'pointer', padding: '0 8px' 
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* 公告列表區 (可捲動) */}
                <div style={{ padding: '20px', overflowY: 'auto' }}>
                {/* Loading 判斷 */}
                    {loading ? (
                        <div style={{ textAlign: 'center', color: '#6b7280', padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                            {/* 簡單的轉圈圈動畫 css 在下面 */}
                            <div className="spinner"></div>
                            <span>資料載入中...</span>
                        </div>
                    ) : announcements.length === 0 ? (
                        <div style={{ textAlign: 'center', color: '#6b7280', padding: '20px' }}>目前沒有公告</div>
                    ) : (
                        announcements.map((ann, index) => {
                            // 判斷是否已讀
                            const isRead = safeReadIds.includes(ann.id);

                            // 定義樣式：預設為 Info (藍) - 消息
                            let badgeStyle = { bg: '#eff6ff', color: '#1d4ed8', border: '#93c5fd', text: '消息' };
                            
                            // 邏輯調整：
                            // 1. warning -> 紅色 -> "警告"
                            // 2. notice -> 橘色 -> "注意"
                            if (ann.type === 'warning') {
                                badgeStyle = { bg: '#fef2f2', color: '#b91c1c', border: '#fca5a5', text: '警告' };
                            } else if (ann.type === 'notice') {
                                badgeStyle = { bg: '#fff7ed', color: '#c2410c', border: '#fdba74', text: '注意' };
                            }

                            return (
                                <details 
                                    key={ann.id || index} 
                                    style={{ 
                                        marginBottom: '15px', border: '1px solid #e5e7eb', borderRadius: '8px', overflow: 'hidden' 
                                    }}
                                >
                                    <summary 
                                        onClick={() => {
                                            // 點擊展開時，如果未讀，則標記為已讀
                                            if (!isRead && typeof onMarkAsRead === 'function') {
                                                onMarkAsRead(ann.id);
                                            }
                                        }}
                                        style={{ 
                                            padding: '15px', cursor: 'pointer', background: '#fff',
                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                            listStyle: 'none', fontWeight: 'bold'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ 
                                                fontSize: '12px', padding: '2px 8px', borderRadius: '4px',
                                                background: badgeStyle.bg,
                                                color: badgeStyle.color,
                                                border: `1px solid ${badgeStyle.border}`
                                            }}>
                                                {badgeStyle.text}
                                            </span>
                                            <span style={{ fontSize: '16px', color: '#1f2937' }}>{ann.title}</span>
                                        </div>
                                        
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            {/* 未讀紅點：只在未讀時顯示，已讀自動消失 */}
                                            {!isRead && (
                                                <span 
                                                    title="未讀公告"
                                                    style={{
                                                        width: '8px', 
                                                        height: '8px', 
                                                        backgroundColor: '#ef4444', 
                                                        borderRadius: '50%',
                                                        display: 'inline-block'
                                                    }}
                                                ></span>
                                            )}
                                            <span style={{ fontSize: '13px', color: '#9ca3af', fontWeight: 'normal' }}>{ann.date}</span>
                                            
                                            {/* 箭頭符號預設為 ▶，加上 CSS class 處理旋轉 */}
                                            <span 
                                                className="arrow-icon"
                                                style={{ 
                                                    fontSize: '12px', 
                                                    color: '#9ca3af', 
                                                    display: 'inline-block',
                                                    transition: 'transform 0.2s ease' // 平滑轉動動畫
                                                }}
                                            >
                                                ▶
                                            </span>
                                        </div>
                                    </summary>
                                    <div style={{ 
                                        padding: '20px', borderTop: '1px solid #f3f4f6', 
                                        background: '#fafafa'
                                    }}>
                                        <SimpleMarkdown content={ann.content} />
                                    </div>
                                </details>
                            );
                        })
                    )}
                </div>
            </div>

            {/* CSS 控制箭頭旋轉 */}
            <style jsx>{`
                details[open] .arrow-icon {
                    transform: rotate(90deg);
                }
                .spinner {
                    border: 3px solid #f3f3f3;
                    border-top: 3px solid #3b82f6;
                    border-radius: 50%;
                    width: 20px;
                    height: 20px;
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}

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
  const [isAnnouncementModalOpen, setIsAnnouncementModalOpen] = useState(false); // 控制彈窗
  const [readAnnouncementIds, setReadAnnouncementIds] = useState([]);            // 記錄已讀公告的 ID
  const [isAnnouncementsLoading, setIsAnnouncementsLoading] = useState(true);    // 公告載入狀態，預設為 true
  const [reannotationCount, setReannotationCount] = useState(0);

  useEffect(() => {
    async function fetchProjects() {
      const { projects, error } = await getProjectsWithProgress(user.id);
      if (error) alert(error);
      else setProjects(projects);
    }

    async function fetchAnnouncements() {
      setIsAnnouncementsLoading(true); // 開始載入
      const { success, announcements } = await getLocalAnnouncements();
      if (success) setAnnouncements(announcements);
      setIsAnnouncementsLoading(false); // 載入完成
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

    // 從 localStorage 讀取已讀紀錄
    const loadReadStatus = () => {
        try {
            const saved = localStorage.getItem(`read_announcements_${user.id}`);
            if (saved) {
                setReadAnnouncementIds(JSON.parse(saved));
            }
        } catch (e) {
            console.error('讀取已讀狀態失敗', e);
        }
    };

    fetchProjects();
    fetchAnnouncements();
    fetchReannotationQueue();
    loadReadStatus();
  }, [user.id]);

  // 計算公告未讀數
  const unreadCount = announcements.filter(ann => !readAnnouncementIds.includes(ann.id)).length;

  // 標記單則已讀的處理函式
  const handleMarkAsRead = (id) => {
      if (!readAnnouncementIds.includes(id)) {
          const newReadIds = [...readAnnouncementIds, id];
          setReadAnnouncementIds(newReadIds);
          // 更新 localStorage
          localStorage.setItem(`read_announcements_${user.id}`, JSON.stringify(newReadIds));
      }
  };

  return (
    <div className="container">
      {/* 載入公告彈窗 */}
      <AnnouncementModal 
          isOpen={isAnnouncementModalOpen} 
          onClose={() => setIsAnnouncementModalOpen(false)} 
          announcements={announcements}
          readIds={readAnnouncementIds}
          onMarkAsRead={handleMarkAsRead}
          loading={isAnnouncementsLoading}
      />

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

        {/* --- 公告按鈕區域 --- */}
        <div style={{ marginBottom: '25px', position: 'relative' }}>
            <button 
                onClick={() => setIsAnnouncementModalOpen(true)}
                className="btn"
                style={{ 
                    width: '100%', 
                    background: '#eff6ff', 
                    color: '#1d4ed8', 
                    border: '1px dashed #93c5fd',
                    padding: '15px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    fontSize: '16px',
                    fontWeight: 'bold',
                    position: 'relative'
                }}
            >
                {/* 左側文字 */}
                <span>📢 查看系統公告</span>
                
                {/* 右側資訊區：包含紅點與日期 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    
                    {/* Loading 判斷 */}
                    {isAnnouncementsLoading ? (
                        <span style={{ fontSize: '13px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '5px' }}>
                           <span className="spinner-small"></span> 載入中...
                        </span>
                    ) : (
                        <>
                            {/* 未讀紅點 (顯示在日期左邊) */}
                            {unreadCount > 0 && (
                                <span style={{
                                    background: '#ef4444',
                                    color: 'white',
                                    fontSize: '12px',
                                    fontWeight: 'bold',
                                    padding: '2px 8px',
                                    borderRadius: '9999px',
                                    boxShadow: '0 2px 4px rgba(239, 68, 68, 0.3)',
                                    animation: 'pulse 2s infinite',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '20px',
                                    minWidth: '20px'
                                }}>
                                    {unreadCount}
                                </span>
                            )}
                            
                            {/* 最新日期 (永遠顯示) */}
                            {announcements.length > 0 && (
                                 <span style={{ fontSize: '13px', fontWeight: 'normal', color: '#60a5fa' }}>
                                     最新公告：{announcements[0]?.date} 上傳
                                 </span>
                            )}
                        </>
                    )}
                </div>
            </button>
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
    
      {/* 增加一點 CSS 動畫讓紅點更生動 */}
      <style jsx>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          50% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

function AllTasksOverviewScreen({ user, project, onBack, onJumpToTask }) {
    const [tasks, setTasks] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currentPage, setCurrentPage] = useState(1);
    
    // 設定每頁顯示幾筆
    const ITEMS_PER_PAGE = 10;

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

    // 計算分頁資料
    const totalPages = Math.ceil(tasks.length / ITEMS_PER_PAGE);
    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
    const currentTasks = tasks.slice(startIndex, startIndex + ITEMS_PER_PAGE);

    // 產生下拉選單的選項 (e.g., 1-20, 21-40...)
    const pageOptions = [];
    for (let i = 0; i < totalPages; i++) {
        const start = i * ITEMS_PER_PAGE + 1;
        const end = Math.min((i + 1) * ITEMS_PER_PAGE, tasks.length);
        pageOptions.push({
            value: i + 1,
            label: `${start} - ${end}`
        });
    }

    // 頁面內部捲動
    const handlePageChange = (newPage) => {
        if (newPage >= 1 && newPage <= totalPages) {
            setCurrentPage(newPage);
        }
    };

    if (loading) return <div className="container"><div className="panel">載入中...</div></div>;

    return (
        // 最外層：固定高度 100vh，使用 Flex 佈局，禁止外層捲動
        // 使用 position: fixed 強制覆蓋整個視窗，解決外層捲動條問題
        <div className="container" style={{ 
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: '#f3f4f6', // 補上背景色，避免透明
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden',
            padding: '20px',      // 改用 padding 來做邊距
            boxSizing: 'border-box',
            zIndex: 1000          // 確保蓋在最上層
        }}>
            {/* 2. Header */}
            <div className="header" style={{ 
                flexDirection: 'column', 
                alignItems: 'stretch', 
                gap: '15px',
                flexShrink: 0,
                marginBottom: '10px'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h1 style={{ fontSize: '20px', margin: 0 }}>{project.name} - 資料總覽</h1>
                    <button 
                        onClick={onBack} 
                        className="btn" 
                        style={{ background: '#6b7280', color: 'white' }}
                    >
                        回到標註頁面
                    </button>
                </div>

                {/* 分頁控制區 */}
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    gap: '15px', 
                    background: '#f3f4f6', 
                    padding: '10px', 
                    borderRadius: '8px',
                    border: '1px solid #e5e7eb'
                }}>
                    {/* 上一頁按鈕 */}
                    <button 
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="btn"
                        style={{ 
                            background: currentPage === 1 ? '#e5e7eb' : 'white', 
                            color: currentPage === 1 ? '#9ca3af' : '#374151',
                            border: '1px solid #d1d5db',
                            padding: '5px 15px'
                        }}
                    >
                        ◀
                    </button>

                    {/* 下拉選單 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', color: '#4b5563' }}>範圍：第</span>
                        <select 
                            value={currentPage} 
                            onChange={(e) => handlePageChange(Number(e.target.value))}
                            style={{ 
                                padding: '6px 12px', 
                                borderRadius: '4px', 
                                border: '1px solid #d1d5db',
                                fontSize: '15px',
                                fontWeight: 'bold',
                                color: '#374151',
                                cursor: 'pointer'
                            }}
                        >
                            {pageOptions.map(opt => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                        <span style={{ fontSize: '14px', color: '#6b7280' }}>
                            筆 (共 {tasks.length} 筆)
                        </span>
                    </div>

                    {/* 下一頁按鈕 */}
                    <button 
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage === totalPages}
                        className="btn"
                        style={{ 
                            background: currentPage === totalPages ? '#e5e7eb' : 'white', 
                            color: currentPage === totalPages ? '#9ca3af' : '#374151',
                            border: '1px solid #d1d5db',
                            padding: '5px 15px'
                        }}
                    >
                        ▶
                    </button>
                </div>
            </div>

            {/* 3. Panel */}
            <div className="panel" style={{ 
                background: '#f9fafb', 
                flex: 1,              
                overflowY: 'auto', 
                minHeight: 0,
                marginTop: '0px',     // 貼近上方 Header
                padding: '20px',      // 讓卡片上方有更多呼吸空間
                boxSizing: 'border-box',
                borderRadius: '8px'   // 頂部加一點圓角
            }}>
                <div style={{ 
                    display: 'grid',
                    // 大約可以顯示 5 欄
                    gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', 
                    gap: '15px',
                    paddingBottom: '10px' // 底部留一點呼吸空間
                }}>
                    {currentTasks.map(task => (
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
                                flexDirection: 'column', // 改為垂直排列
                                gap: '10px',
                                height: '250px', // 固定高度，讓卡片變高
                                transition: 'transform 0.1s, box-shadow 0.1s',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                overflow: 'hidden'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.transform = 'translateY(-4px)';
                                e.currentTarget.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1)';
                                e.currentTarget.style.borderColor = '#6366f1';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                                e.currentTarget.style.borderColor = '#e5e7eb';
                            }}
                        >
                            {/* 卡片頂部：題號與狀態 */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f3f4f6', paddingBottom: '8px' }}>
                                <div style={{ fontWeight: 'bold', fontSize: '16px', color: '#1f2937' }}>
                                    第 {task.sequence} 筆
                                </div>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <span style={{ fontSize: '20px', color: task.is_marked ? '#ec4899' : '#e5e7eb' }}>
                                        {task.is_marked ? '★' : '☆'}
                                    </span>
                                </div>
                            </div>
                            
                            {/* 狀態標籤區 */}
                            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
                                {task.skipped && <span style={{ fontSize: '12px', background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '12px' }}>待補</span>}
                                {task.status === 'completed' && !task.skipped && <span style={{ fontSize: '12px', background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '12px' }}>完成</span>}
                                {task.status !== 'completed' && !task.skipped && <span style={{ fontSize: '12px', background: '#f3f4f6', color: '#6b7280', padding: '2px 8px', borderRadius: '12px' }}>未填</span>}
                            </div>

                            {/* 內容區：允許多行文字 */}
                            <div style={{ 
                                flex: 1, 
                                color: '#4b5563', 
                                fontSize: '14px', 
                                lineHeight: '1.6',
                                overflow: 'hidden',
                                display: '-webkit-box',
                                WebkitLineClamp: 5, // 限制顯示約 5 行，然後自動「...」
                                WebkitBoxOrient: 'vertical',
                                whiteSpace: 'normal', // 允許換行
                                textOverflow: 'ellipsis'
                            }}>
                                {task.preview_text}
                            </div>
                            
                            {/* 底部提示 */}
                            <div style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'right', marginTop: 'auto' }}>
                                頁碼: {task.page_number}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function HistoryModal({ isOpen, onClose, history, loading }) {
    if (!isOpen) return null;

    // 輔助函式：將輪次數字轉為易讀文字
    const getRoundLabel = (round) => {
        if (!round || round === 0) return '初次標註';
        if (round === 1) return '第一輪重標';
        if (round === 2) return '第二輪重標';
        return `第 ${round} 輪重標`;
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        }} onClick={onClose}>
            <div style={{
                background: 'white', padding: '20px', borderRadius: '8px',
                width: '750px',
                maxHeight: '80vh', overflowY: 'auto',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)'
            }} onClick={e => e.stopPropagation()}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                    <h3 style={{ margin: 0 }}>📜 標註歷史紀錄</h3>
                    <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '18px' }}>×</button>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '20px' }}>載入中...</div>
                ) : history.length === 0 ? (
                    <div style={{ color: '#666', textAlign: 'center' }}>尚無修改紀錄</div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                        <thead>
                            <tr style={{ background: '#f3f4f6', borderBottom: '2px solid #e5e7eb' }}>
                                <th style={{ padding: '8px', textAlign: 'left', width: '110px' }}>階段</th>
                                <th style={{ padding: '8px', textAlign: 'left', width: '155px' }}>時間</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>變更欄位</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>舊值</th>
                                <th style={{ padding: '8px', textAlign: 'left' }}>新值</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((log, idx) => {
                                // 計算序號：總筆數 - 目前索引 = 第 N 次
                                const seqNumber = history.length - idx;
                                
                                return (
                                    <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                                        {/* 顯示「第 N 次標註」 */}
                                        <td style={{ padding: '8px' }}>
                                            <span style={{ 
                                                background: '#e0f2fe', color: '#0369a1', 
                                                padding: '2px 8px', borderRadius: '10px', fontSize: '12px',
                                                fontWeight: 'bold'
                                            }}>
                                                第 {seqNumber} 次標註
                                            </span>
                                        </td>
                                        <td style={{ padding: '8px', color: '#6b7280', fontSize: '12px' }}>{log.changed_at}</td>
                                        <td style={{ padding: '8px', fontWeight: 'bold' }}>{log.task_name}</td>
                                        <td style={{ padding: '8px', color: '#ef4444' }}>{log.old_value || '(空)'}</td>
                                        <td style={{ padding: '8px', color: '#10b981' }}>{log.new_value}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
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
    const [reannotationList, setReannotationList] = useState([]);
    const [loadingReannotation, setLoadingReannotation] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [historyData, setHistoryData] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);

    // 處理點擊資料筆數
    const handleShowHistory = async (task) => {
        setIsHistoryModalOpen(true);
        setHistoryLoading(true);
        // 呼叫後端 action
        const res = await getReannotationHistory(task.id, user.id); // 這裡 task.id 應該對應 source_data_id
        if (res.success) {
            setHistoryData(res.history);
        } else {
            alert('載入歷史失敗');
        }
        setHistoryLoading(false);
    };

    // --- 輔助函式：去除重複的任務 (根據 ID) ---
    const getUniqueTasks = (tasks) => {
        if (!Array.isArray(tasks)) return [];
        const seen = new Set();
        return tasks.filter(task => {
            const duplicate = seen.has(task.id);
            seen.add(task.id);
            return !duplicate;
        });
    };

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
            // 先去重再設定 State
            const uniqueTasks = getUniqueTasks(allTasksRes.tasks);
            setAllTasks(uniqueTasks);
            
            // 計算跳過數量 (也要用去重後的資料算才準確)
            const skipped = uniqueTasks.filter(t => t.skipped === true).length;
            setSkippedCount(skipped);
        }
    };

    const loadPreviousTask = async () => {
        // 判斷是否在重標模式（專案已完成）
        const isProjectCompleted = progress.completed + skippedCount >= progress.total && progress.total > 0;

        // 如果專案已完成且有重標列表，優先使用重標列表導航
        if (isProjectCompleted && reannotationList && reannotationList.length > 0) {
            // 找出當前項目在重標列表中的位置
            let currentIndex = -1;
            if (currentItem) {
                currentIndex = reannotationList.findIndex(t => String(t.id) === String(currentItem.id));
            }

            if (currentIndex > 0) {
                // 還有上一筆
                const prevInList = reannotationList[currentIndex - 1];
                const res = await getTaskBySequence(project.id, user.id, prevInList.sequence);
                if (res.task) {
                    setCurrentItem(res.task);
                    loadTaskData(res.task);
                    return;
                }
            } else if (currentIndex === 0) {
                // 已經是第一筆
                alert('已經是重標註列表的第一筆');
                return;
            } else if (currentItem === null) {
                // 在完成頁面，跳到重標列表最後一筆
                const lastInList = reannotationList[reannotationList.length - 1];
                const res = await getTaskBySequence(project.id, user.id, lastInList.sequence);
                if (res.task) {
                    setCurrentItem(res.task);
                    loadTaskData(res.task);
                    return;
                }
            }
        }

        // 一般模式：依原本順序找上一筆
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

        // 判斷是否在重標模式
        const isProjectCompleted = progress.completed + skippedCount >= progress.total && progress.total > 0;
        const isInReannotationList = reannotationList && reannotationList.length > 0 &&
            reannotationList.some(t => String(t.id) === String(currentItem.id));
        const isReannotationMode = isProjectCompleted && isInReannotationList;

        const newState = !isMarked;
        setIsMarked(newState);

        try {
            const result = await toggleAnnotationMark(currentItem.id, user.id, isReannotationMode);
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

    // 抓取該專案重標註任務的函式
    const fetchProjectReannotationTasks = async () => {
        // 安全檢查：如果沒有專案或使用者資訊，直接不執行
        if (!project || !project.id || !user || !user.id) return;

        setLoadingReannotation(true);
        try {
            // 呼叫 Next.js API（app/api/consistency/route.js）
            const response = await fetch(`/api/consistency?projectId=${project.id}&userId=${user.id}`);
            const result = await response.json();
            
            // 檢查回應狀態，避免伺服器錯誤導致崩潰
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            if (result.success && Array.isArray(result.tasks)) {
            // 只留下「需要重標註 (分數 < 0.8)」或者「已修正過 (modify_count > 0)」的資料
                const filteredTasks = result.tasks.filter(t => t.needs_reannotation || t.modify_count > 0);
                // 按 sequence 排序（原始標註順序）
                filteredTasks.sort((a, b) => parseInt(a.sequence) - parseInt(b.sequence));
                console.log('[reannotationList] 排序後前5筆:', filteredTasks.slice(0, 5).map(t => ({ id: t.id, seq: t.sequence })));
                setReannotationList(filteredTasks);
            } else {
                setReannotationList([]);
            }
        } catch (error) {
            console.error('載入重標註列表失敗:', error);
            setReannotationList([]);
        }
        setLoadingReannotation(false);
    };

    useEffect(() => {
        const isProjectCompleted = currentItem === null && progress.completed + skippedCount >= progress.total && progress.total > 0;

        if (isProjectCompleted) {
            fetchProjectReannotationTasks();
        }
    }, [currentItem, progress, skippedCount]); // 監聽這些變數變化

    // 當頁面重新獲得焦點時（從其他頁面返回），重新載入一致性分數
    useEffect(() => {
        const handleVisibilityChange = () => {
            // 只在專案完成時才重新載入
            const isProjectCompleted = currentItem === null && progress.completed + skippedCount >= progress.total && progress.total > 0;
            if (!document.hidden && isProjectCompleted && project && user) {
                fetchProjectReannotationTasks();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [currentItem, progress, skippedCount, project, user]); // 監聽相關變數

    const handleSaveAndNext = async () => {
        if (!currentItem) return;

        // --- 1. 表單驗證 ---
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

        // --- 2. 準備並儲存資料 ---
        // 判斷是否在重標模式：專案已完成 + 目前這筆在重標註列表中
        const isProjectCompleted = progress.completed + skippedCount >= progress.total && progress.total > 0;
        const isInReannotationList = reannotationList && reannotationList.length > 0 &&
            reannotationList.some(t => String(t.id) === String(currentItem.id));
        const isReannotationMode = isProjectCompleted && isInReannotationList;

        const annotationData = {
            source_data_id: currentItem.id,
            user_id: user.id,
            esg_type: esgTypes.join(','),
            promise_status: promiseStatus,
            promise_string: promiseText,
            verification_timeline: verificationTimeline,
            evidence_status: evidenceStatus,
            evidence_string: evidenceText,
            evidence_quality: evidenceQuality,
            isReannotationMode  // 傳給後端判斷要存到哪個 round
        };

        console.log('[handleSaveAndNext] 儲存資料:', {
            source_data_id: annotationData.source_data_id,
            currentItem_id: currentItem.id,
            isReannotationMode
        });

        const result = await saveAnnotation(annotationData);
        if (!result.success) {
            alert(`儲存失敗: ${result.error}`);
            return;
        }

        // 存檔成功後，立刻重新抓取後端最新的分數列表，確保紅綠燈即時變更
        await fetchProjectReannotationTasks();

        // --- 3. 清理當前畫面狀態 ---
        // 清除所有標記（切換到下一筆時重置）
        if (dataTextRef.current && currentItem) {
            dataTextRef.current.innerHTML = currentItem.original_data;
        }
        setEsgTypes([]);
        setPromiseStatus('');
        setVerificationTimeline('');
        setEvidenceStatus('');
        setEvidenceQuality('');

        // --- 4. 判斷並載入下一筆任務 ---
        let nextTask = null;

        // 優先邏輯：如果重標註列表有資料，嘗試從列表中找下一筆
        if (reannotationList && reannotationList.length > 0) {
            // 找出當前這筆在列表中的位置
            const currentIndex = reannotationList.findIndex(t => t.id === currentItem.id);
            
            // 如果這筆在列表裡，而且後面還有資料，就抓下一筆
            if (currentIndex !== -1 && currentIndex < reannotationList.length - 1) {
                const nextInList = reannotationList[currentIndex + 1];
                
                // 為了保險，用 ID 再去後端抓一次完整資料
                const res = await getTaskBySequence(project.id, user.id, nextInList.sequence);
                if (res.task) {
                    nextTask = res.task;
                }
            }
        }

        // [備案] 邏輯：如果在重標清單裡找不到（例如已經修完最後一筆紅燈），或是清單是空的
        // 就維持原本的行為：依照物理順序抓下一筆
        if (!nextTask) {
             const nextRes = await getNextTaskAfterCurrent(project.id, user.id, currentItem.id);
             nextTask = nextRes.task;
        }

        // 執行跳轉
        if (nextTask) {
            setCurrentItem(nextTask);
            loadTaskData(nextTask); // 使用現有的函式來載入資料與高亮
            
            // 更新網址 (選用，讓瀏覽器上一頁/下一頁能運作)
            window.history.pushState(null, '', `?project=${project.id}&sequence=${nextTask.sequence}`);
        } else {
            // 如果沒有下一筆，顯示完成訊息
            setCurrentItem(null);
        }

        // --- 5. 樂觀更新全域狀態 (進度條、下拉選單) ---
        
        // A. 更新下拉選單的狀態 (allTasks)
        setAllTasks(prevTasks => prevTasks.map(t => {
            if (t.id === annotationData.source_data_id) {
                // 如果這筆原本沒完成，現在完成了，要順便加進度
                return { ...t, status: 'completed', skipped: false };
            }
            return t;
        }));

        // B. 更新進度條 (Progress)
        // 先檢查這筆任務在更新前是不是「未完成」的，如果是，進度才 +1
        const targetTask = allTasks.find(t => t.id === annotationData.source_data_id);
        if (targetTask && targetTask.status !== 'completed') {
            setProgress(prev => ({
                ...prev,
                completed: prev.completed + 1
            }));
        }

        // C. 如果有驗證結果，重新驗證以更新警告框 (這部分維持原樣，或也可以選擇暫時隱藏)
        if (validationResult) {
            const newValidation = await validateCompletedAnnotations(project.id, user.id);
            if (!newValidation.error) {
                setValidationResult(newValidation);
            }
        }
    };

    const handleSkip = async () => {
        if (!currentItem) return;

        // 判斷是否在重標模式（目前這筆在重標註列表中）
        const isInReannotationMode = reannotationList && reannotationList.length > 0 && reannotationList.some(t => String(t.id) === String(currentItem.id));

        let nextTask = null;

        if (isInReannotationMode) {
            // 從重標註列表找下一筆
            const currentIndex = reannotationList.findIndex(t => String(t.id) === String(currentItem.id));

            if (currentIndex !== -1 && currentIndex < reannotationList.length - 1) {
                const nextInList = reannotationList[currentIndex + 1];
                const res = await getTaskBySequence(project.id, user.id, nextInList.sequence);
                if (res.task) {
                    nextTask = res.task;
                }
            }
        } else {
            // 一般模式：跳到順序的下一筆
            const nextRes = await getNextTaskAfterCurrent(project.id, user.id, currentItem.id);
            if (nextRes.task) {
                nextTask = nextRes.task;
            }
        }

        // 更新到下一筆或回到完成頁面
        if (nextTask) {
            setCurrentItem(nextTask);
            loadTaskData(nextTask);
            // 更新文字內容
            if (dataTextRef.current && nextTask.original_data) {
                dataTextRef.current.innerHTML = nextTask.original_data;
            }
        } else {
            setCurrentItem(null);
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
        
        // 檢查選取範圍是否在文本框內
        if (!container.contains(range.commonAncestorContainer)) {
            // 有時候使用者選太快會選到外面，這裡做個寬容檢查
            return; 
        }
        
        try {
            const span = document.createElement('span');
            span.className = `highlight-${type}`;
            
            // 使用 extractContents + insert 比較不會因為跨標籤而報錯
            span.appendChild(range.extractContents());
            range.insertNode(span);
            
            // 清除選取狀態
            selection.removeAllRanges();
        } catch (err) {
            console.warn('標記失敗:', err);
            alert('標記失敗：請試著不要選取到已經標記過的文字邊界，或分段選取。');
        }
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

    // 修正後的 highlightByPositions 函式 (加入 try-catch 防護)
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

                    // --- 修正開始：加入邊界檢查與錯誤捕獲 ---
                    if (relativeStart > nodeLength || relativeEnd > nodeLength) {
                        console.warn(`[標記略過] 索引越界: 嘗試在長度 ${nodeLength} 的節點標記 ${relativeStart}-${relativeEnd}`);
                        break;
                    }

                    try {
                        const range = document.createRange();
                        range.setStart(node, relativeStart);
                        range.setEnd(node, relativeEnd);

                        const span = document.createElement('span');
                        span.className = `highlight-${type}`;
                        range.surroundContents(span);
                    } catch (err) {
                        console.warn('無法標記範圍 (可能是結構變更或索引錯誤):', err);
                    }
                    // --- 修正結束 ---
                    
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

    // 一鍵清除所有標記
    const clearAllHighlights = () => {
        if (!dataTextRef.current || !currentItem) return;

        // 1. 將內容還原為原始資料 (移除所有 span 標籤)
        dataTextRef.current.innerHTML = currentItem.original_data;

        // 2. 清除當前的瀏覽器選取範圍
        const selection = window.getSelection();
        if (selection) selection.removeAllRanges();
    };

    const toggleEsgType = (type) => setEsgTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
    
    useEffect(() => { if (promiseStatus === 'No') { setVerificationTimeline('N/A'); setEvidenceStatus('N/A'); } }, [promiseStatus]);
    useEffect(() => { if (evidenceStatus !== 'Yes') setEvidenceQuality('N/A'); }, [evidenceStatus]);

return (
        <div className="container">

            <HistoryModal 
                isOpen={isHistoryModalOpen} 
                onClose={() => setIsHistoryModalOpen(false)} 
                history={historyData}
                loading={historyLoading}
            />

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
                    {/* 右側使用者資訊區 */}
                    <div style={{ 
                        marginLeft: 'auto', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'flex-end',
                        marginTop: '10px',
                        position: 'relative'
                    }}>
                        {/* 顯示條件：當專案已完成 (進度100%) 且 目前不在完成頁面 (currentItem不為null) 時顯示 */}
                        {(progress.completed + skippedCount >= progress.total) && currentItem !== null && (
                            <button
                                onClick={() => setCurrentItem(null)} 
                                style={{
                                    position: 'absolute',  // 絕對定位：浮在上方
                                    top: '-45px',          // 往上移動
                                    right: 0,              // 靠右對齊
                                    background: '#f59e0b',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    padding: '10px 18px',   // 內距：按鈕高度與寬度
                                    fontSize: '14px',      // 按鈕文字大小
                                    cursor: 'pointer',
                                    fontWeight: 'bold',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    whiteSpace: 'nowrap'
                                }}
                            >
                                返回重標註清單 🚀
                            </button>
                        )}
                        <span style={{ fontWeight: 'bold', fontSize: '16px' }}>
                            標註者: {user.username}
                        </span>
                    </div>
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
                    borderTop: '1px solid #e5e7eb'
                }}>
                    
                    {/* [左側區塊] */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' }}>
                        {/* 1. 個人進度 */}
                        <div style={{ fontSize: '14px', color: '#4b5563', fontWeight: '500' }}>
                            目前完成筆數：{progress.completed} / {progress.total}
                        </div>

                        {/* 2. 跳轉選單 */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ whiteSpace: 'nowrap', fontSize: '14px', color: '#374151' }}>跳到第幾筆:</span>
                            <select 
                                value={selectedSequence} 
                                onChange={handleSequenceJump} 
                                style={{ 
                                    padding: '6px 10px', 
                                    border: '1px solid #d1d5db', 
                                    borderRadius: '4px', 
                                    minWidth: '150px', 
                                    fontSize: '14px',
                                    color: '#374151'
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
                                        {markPrefix}{status} 第 {task.sequence} 筆
                                    </option>;
                                })}
                            </select>
                        </div>
                    </div>

                    {/* [右側區塊] */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        
                        {/* 3. 參考資源 */}
                        <div style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '12px',
                            borderRight: '1px solid #d1d5db', // 分隔線
                            paddingRight: '20px'
                        }}>
                            <span style={{ fontWeight: 'bold', color: '#4b5563', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                📚 參考資料：
                            </span>
                            <a href="https://hackmd.io/@wesley12345/H14L7CWAxe#AI-CUP-%E6%A8%99%E8%A8%BB%E6%89%8B%E5%86%8A" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '500' }}>
                                📖 AI CUP 標註手冊
                            </a>
                            <span style={{ color: '#cbd5e1' }}>|</span>
                            <a href="https://docs.google.com/presentation/d/1px_pWnWi67JQEfLa448btzWxGLlSiQPvpDMHDbXtbm8/edit?usp=sharing" target="_blank" rel="noopener noreferrer" style={{ color: '#ea580c', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '500' }}>
                                📊 系統教學投影片（20260108版）
                            </a>
                        </div>

                        {/* 4. 五個操作按鈕 */}
                        <div className="nav-btns" style={{ display: 'flex', gap: '8px' }}>
                            <button
                                className="btn"
                                onClick={onShowOverview}
                                title="查看所有資料"
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
                                className="nav-btn btn-emerald"
                                onClick={handleSaveAndNext}
                                disabled={!currentItem}
                            >
                                儲存 & 下一筆
                            </button>

                            {/* 初次標註模式才顯示「下一筆」按鈕（不儲存直接跳） */}
                            {!(progress.completed + skippedCount >= progress.total && progress.total > 0) && (
                                <button
                                    className="btn"
                                    onClick={handleSkip}
                                    disabled={!currentItem}
                                    style={{ background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db' }}
                                >
                                    下一筆 →
                                </button>
                            )}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    
                    {/* 1. 恭喜訊息 Panel */}
                    <div className="panel" style={{ borderLeft: '5px solid #10b981' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontSize: '24px' }}>🎉</span>
                            <div>
                                <h2 style={{ margin: 0, color: '#064e3b' }}>恭喜！您已完成此專案的所有標註！</h2>
                                <p style={{ margin: '5px 0 0 0', color: '#6b7280' }}>
                                    請點擊「<strong style={{ color: '#3b82f6' }}>✓ 驗證資料完整性</strong>」按鈕確保所有資料都是完整的。
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* 載入中狀態 */}
                    {loadingReannotation && (
                        <div className="panel" style={{ textAlign: 'center', padding: '40px' }}>
                            <div className="spinner" style={{ margin: '0 auto 10px auto' }}></div>
                            <span style={{ color: '#6b7280', fontWeight: 'bold' }}>正在分析一致性分數與重標註清單，請稍候...</span>
                        </div>
                    )}

                    {/* 2. 重標註任務列表 (只在非載入中且有資料時顯示) */}
                    {!loadingReannotation && reannotationList.length > 0 && (
                        <div className="reannotation-container">
                            {/* ... (這裡面的內容維持不變) ... */}
                            <div className="reannotation-header">
                                <h3>📋 重標註項目 ({reannotationList.length} 筆)</h3>
                                <span style={{ fontSize: '13px', color: '#64748b' }}>
                                    以下資料的一致性分數較低，建議您重新檢視
                                </span>
                            </div>
                            
                            <div style={{ overflowX: 'auto' }}>
                            <table className="re-table">
                                <thead>
                                    <tr>
                                        <th style={{ width: '80px', fontSize: '13px' }}>狀態</th>
                                        <th style={{ width: '90px', fontSize: '13px' }}>資料</th>
                                        <th style={{ minWidth: '150px', fontSize: '13px' }}>文本</th>
                                        <th style={{ width: '150px', fontSize: '13px' }}>儲存次數</th>
                                        <th style={{ width: '120px', fontSize: '13px' }}>承諾狀態</th>
                                        <th style={{ width: '120px', fontSize: '13px' }}>驗證時間</th>
                                        <th style={{ width: '120px', fontSize: '13px' }}>證據狀態</th>
                                        <th style={{ width: '120px', fontSize: '13px' }}>證據品質</th>
                                        <th style={{ width: '150px' }}>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {reannotationList.map((task, index) => {
                                        // 輔助函式：分數樣式 (低分紅字)
                                        const getScoreStyle = (score) => ({
                                            fontWeight: '700',
                                            fontFamily: 'monospace',
                                            color: score < 0.6 ? '#ef4444' : '#94a3b8'
                                        });
                                        const fmt = (n) => (typeof n === 'number' ? n.toFixed(2) : '-');

                                        return (
                                            <tr key={task.id || index}>
                                                {/* 狀態燈號 */}
                                                <td data-label="狀態">
                                                    {/* 邏輯：modify_count > 0 ? 綠 : 紅 */}
                                                    <span className={`status-dot ${task.modify_count > 0 ? 'green' : 'red'}`}></span>
                                                </td>
                                                
                                                {/* 資料筆數 (按鈕) - 顯示重標註紀錄 */}
                                                <td data-label="資料">
                                                    <button 
                                                        onClick={() => handleShowHistory(task)}
                                                        style={{ 
                                                            background: 'none', border: 'none', 
                                                            color: '#2563eb', fontWeight: 'bold', 
                                                            cursor: 'pointer', textDecoration: 'underline' 
                                                        }}
                                                        title="點擊查看修改歷史"
                                                    >
                                                        第 {task.sequence} 筆
                                                    </button>
                                                </td>

                                                {/* 文本預覽欄位 */}
                                                <td data-label="文本">
                                                <div className="text-preview" title={task.preview_text}>
                                                        {task.preview_text}
                                                    </div>
                                                </td>
                                                
                                                {/* 儲存次數欄位 */}
                                                <td data-label="儲存次數" style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                    {task.modify_count}
                                                </td>
                                                
                                                {/* 一致性分數欄位 - 四大維度 */}
                                                <td data-label="承諾狀態分">
                                                    <span style={getScoreStyle(task.s_promise)}>{fmt(task.s_promise)}</span>
                                                </td>
                                                <td data-label="驗證時間分">
                                                    <span style={getScoreStyle(task.s_timeline)}>{fmt(task.s_timeline)}</span>
                                                </td>
                                                <td data-label="證據狀態分">
                                                    <span style={getScoreStyle(task.s_evidence)}>{fmt(task.s_evidence)}</span>
                                                </td>
                                                <td data-label="證據品質分">
                                                    <span style={getScoreStyle(task.s_quality)}>{fmt(task.s_quality)}</span>
                                                </td>

                                                {/* 重標註按鈕欄位 */}
                                                <td data-label="操作">
                                                    <button 
                                                        className="btn-reannotate"
                                                        style={{
                                                            // 邏輯：modify_count > 0 ? 綠(再次檢視) : 橘(重標註)
                                                            backgroundColor: task.modify_count > 0 ? '#10b981' : '#f59e0b',
                                                            transition: 'background-color 0.3s'
                                                        }}
                                                        onClick={() => {
                                                            handleSequenceJump({ target: { value: task.sequence } });
                                                        }}
                                                    >
                                                        {task.modify_count > 0 ? '再次檢視' : '重標註'}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                   {/* 無重標註資料時的提示 (只在非載入中且無資料時顯示) */}
                    {!loadingReannotation && reannotationList.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '20px', color: '#9ca3af' }}>
                            沒有需要重標註的任務，辛苦了👍！
                        </div>
                    )}
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
                            <h2>
                                第 {allTasks.find(t => t.id === currentItem.id)?.sequence || '-'} 筆文本內容
                                （ID：{currentItem.id}, 頁碼：{currentItem.page_number}）
                            </h2>
                            <div className="info-box">用滑鼠選取文字後點擊下方按鈕: 黃色=承諾 / 藍色=證據 / 清除選取標記=橡皮擦（只清除選取的標記）</div>
                            <div ref={dataTextRef} className="text-area"></div>
                            {/* 螢光筆工具列 */}
                            <div className="btn-group" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                                <span style={{ fontWeight: 'bold', marginRight: '5px', fontSize: '14px' }}>
                                    選取後標記：
                                </span>
                                <button
                                    className="btn"
                                    style={{
                                        backgroundColor: '#f9f2d2ff',
                                        color: '#282828ff',
                                        border: '1px solid #eab308',
                                        fontWeight: '600'
                                    }}
                                    onMouseDown={(e) => { e.preventDefault(); highlightSelection('promise'); }}
                                >
                                    承諾語句
                                </button>
                                <button
                                    className="btn"
                                    style={{
                                        backgroundColor: '#bae6fd',
                                        color: '#282828ff',
                                        border: '1px solid #79b3faff',
                                        fontWeight: '600'
                                    }}
                                    onMouseDown={(e) => { e.preventDefault(); highlightSelection('evidence'); }}
                                >
                                    證據語句
                                </button>

                                <button
                                    className="btn btn-secondary"
                                    onMouseDown={(e) => { e.preventDefault(); clearSelectedHighlights(); }}
                                    title="請先選取要清除的標記文字範圍，再點擊此按鈕"
                                >
                                    清除選取標記
                                </button>

                                {/* 右側全部清除按鈕 (維持原本樣式，但功能已更新為不跳彈窗) */}
                                <button
                                    className="btn"
                                    style={{ 
                                        backgroundColor: '#ef4444', 
                                        color: 'white', 
                                        marginLeft: '10px' 
                                    }}
                                    onMouseDown={(e) => { e.preventDefault(); clearAllHighlights(); }}
                                    title="不用選取，直接移除所有顏色"
                                >
                                    全部清除
                                </button>
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