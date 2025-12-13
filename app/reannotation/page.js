// 檔案路徑: app/reannotation/page.js
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function ReannotationPage() {
  const [user, setUser] = useState(null);
  const [queueData, setQueueData] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  // 主題配色
  const theme = {
    bg: '#ffffff',
    bgPanel: '#ffffff',
    text: '#111827',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    borderLight: '#f3f4f6',
    shadow: '0 1px 3px rgba(0,0,0,0.1)',
    tableHeader: '#f9fafb',
    tableHover: '#f9fafb',
    statCard: '#f9fafb',
    warningBg: '#fef3c7',
    warningBorder: '#f59e0b',
    dangerBg: '#fee2e2',
    dangerBorder: '#ef4444'
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('annotatorUser');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      loadQueue(parsedUser.id);
    } else {
      alert('請先登入');
      router.push('/');
    }
  }, [router]);

  const loadQueue = async (userId) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reannotation/queue?userId=${userId}`);
      const result = await response.json();

      if (result.success) {
        setQueueData(result.data);
      } else {
        console.error('載入重標註清單失敗:', result.error);
      }
    } catch (error) {
      console.error('載入重標註清單失敗:', error);
    } finally {
      setLoading(false);
    }
  };

  const getGroupName = (taskGroup) => {
    const names = {
      group1: '承諾與時間軸',
      group2: '證據狀態與品質'
    };
    return names[taskGroup] || taskGroup;
  };

  const getTaskName = (taskKey) => {
    const names = {
      promise_status: '承諾狀態',
      verification_timeline: '驗證時間軸',
      evidence_status: '證據狀態',
      evidence_quality: '證據品質'
    };
    return names[taskKey] || taskKey;
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { text: '待處理', color: '#f59e0b', bg: '#fef3c7' },
      in_progress: { text: '進行中', color: '#3b82f6', bg: '#dbeafe' },
      submitted: { text: '已送出', color: '#10b981', bg: '#d1fae5' },
      skipped: { text: '已跳過', color: '#6b7280', bg: '#f3f4f6' }
    };
    const badge = badges[status] || badges.pending;

    return (
      <span style={{
        display: 'inline-block',
        padding: '4px 12px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '600',
        color: badge.color,
        background: badge.bg
      }}>
        {badge.text}
      </span>
    );
  };

  if (!user) {
    return <div className="container"><h1>驗證中...</h1></div>;
  }

  return (
    <div className="container" style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '20px',
      background: theme.bg,
      minHeight: '100vh'
    }}>
      <style jsx>{`
        .container {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }
        .header {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          padding: 30px;
          border-radius: 12px;
          margin-bottom: 30px;
        }
        .panel {
          background: ${theme.bgPanel};
          color: ${theme.text};
          border-radius: 12px;
          padding: 25px;
          margin-bottom: 20px;
          box-shadow: ${theme.shadow};
        }
        .btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          text-decoration: none;
          display: inline-block;
        }
        .btn-primary {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
        }
        .btn-primary:hover {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
        }
        .btn-secondary {
          background: #6b7280;
          color: white;
        }
        .btn-secondary:hover {
          background: #4b5563;
        }
        .stat-card {
          background: ${theme.statCard};
          padding: 20px;
          border-radius: 10px;
          text-align: center;
        }
        .stat-value {
          font-size: 2.5rem;
          font-weight: 700;
          color: #f59e0b;
          margin: 10px 0;
        }
        .stat-label {
          font-size: 0.9rem;
          color: ${theme.textSecondary};
        }
        .task-group-card {
          background: ${theme.bgPanel};
          border: 2px solid ${theme.border};
          border-radius: 12px;
          padding: 25px;
          margin-bottom: 20px;
          transition: all 0.3s;
        }
        .task-group-card:hover {
          border-color: #f59e0b;
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1);
        }
        .task-list-item {
          background: ${theme.tableHover};
          border: 1px solid ${theme.border};
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transition: all 0.2s;
        }
        .task-list-item:hover {
          background: #fef3c7;
          border-color: #f59e0b;
        }
        .flagged-tasks {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          margin-top: 8px;
        }
        .flagged-badge {
          display: inline-block;
          padding: 4px 8px;
          background: ${theme.dangerBg};
          color: ${theme.dangerBorder};
          border-radius: 6px;
          font-size: 11px;
          font-weight: 600;
        }
        .score-badge {
          display: inline-block;
          padding: 2px 6px;
          background: #fee2e2;
          color: #991b1b;
          border-radius: 4px;
          font-size: 10px;
          margin-left: 4px;
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 10px 0' }}>🔄 重標註任務</h1>
            <p style={{ margin: 0, opacity: 0.9 }}>
              檢視並修改一致性較低的標註項目
            </p>
          </div>
          <button
            className="btn btn-secondary"
            onClick={() => router.push('/')}
          >
            ← 返回主頁
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="panel" style={{ textAlign: 'center' }}>
          <p>載入中...</p>
        </div>
      )}

      {/* 統計摘要 */}
      {queueData && queueData.stats && (
        <div className="panel">
          <h2 style={{ marginBottom: '20px' }}>任務統計</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px' }}>
            <div className="stat-card">
              <div className="stat-label">總任務數</div>
              <div className="stat-value">{queueData.stats.totalTasks}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">待處理</div>
              <div className="stat-value" style={{ color: '#f59e0b' }}>
                {queueData.stats.pendingTasks}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">進行中</div>
              <div className="stat-value" style={{ color: '#3b82f6' }}>
                {queueData.stats.inProgressTasks}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">已完成</div>
              <div className="stat-value" style={{ color: '#10b981' }}>
                {queueData.stats.submittedTasks}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 任務列表 */}
      {queueData && queueData.tasks && queueData.tasks.length > 0 ? (
        queueData.tasks.map(group => (
          <div key={`${group.projectId}_${group.taskGroup}`} className="task-group-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '20px' }}>
              <div>
                <h2 style={{ margin: '0 0 8px 0', color: theme.text }}>
                  📁 {group.projectName}
                </h2>
                <p style={{ margin: 0, color: theme.textSecondary, fontSize: '14px' }}>
                  任務組別: <strong>{getGroupName(group.taskGroup)}</strong> |
                  輪次: <strong>Round {group.roundNumber}</strong> |
                  門檻: <strong>{group.threshold}</strong>
                </p>
              </div>
              <span style={{
                padding: '8px 16px',
                background: theme.warningBg,
                color: theme.warningBorder,
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '600'
              }}>
                {group.tasks.length} 筆待處理
              </span>
            </div>

            {/* 任務清單 */}
            <div>
              {group.tasks.slice(0, 5).map(task => (
                <div key={task.taskId} className="task-list-item">
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                      <span style={{ fontWeight: 'bold', color: theme.text }}>
                        #{task.sourceDataId}
                      </span>
                      <span style={{ fontSize: '13px', color: theme.textSecondary }}>
                        頁碼: {task.pageNumber}
                      </span>
                      {getStatusBadge(task.status)}
                    </div>
                    <div style={{ fontSize: '14px', color: theme.text, marginBottom: '8px', lineHeight: '1.5' }}>
                      {task.originalData.substring(0, 120)}
                      {task.originalData.length > 120 && '...'}
                    </div>
                    <div className="flagged-tasks">
                      {Object.entries(task.tasksFlagged).map(([taskKey, score]) => (
                        <span key={taskKey} className="flagged-badge">
                          ⚠️ {getTaskName(taskKey)}
                          <span className="score-badge">α={score.toFixed(2)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <Link
                      href={`/reannotation/${task.taskId}`}
                      className="btn btn-primary"
                      style={{ padding: '8px 16px', fontSize: '13px' }}
                    >
                      {task.status === 'submitted' ? '查看' : '開始修改'}
                    </Link>
                  </div>
                </div>
              ))}

              {group.tasks.length > 5 && (
                <div style={{ textAlign: 'center', marginTop: '15px' }}>
                  <p style={{ color: theme.textSecondary, fontSize: '14px' }}>
                    還有 {group.tasks.length - 5} 筆任務...
                  </p>
                </div>
              )}
            </div>
          </div>
        ))
      ) : (
        !loading && (
          <div className="panel" style={{ textAlign: 'center', padding: '60px', color: theme.textSecondary }}>
            <div style={{ fontSize: '4rem', marginBottom: '20px' }}>✅</div>
            <h3 style={{ color: theme.text }}>太棒了！目前沒有待處理的重標註任務</h3>
            <p>如果管理員建立新的重標註輪次，任務會顯示在這裡。</p>
          </div>
        )
      )}
    </div>
  );
}
