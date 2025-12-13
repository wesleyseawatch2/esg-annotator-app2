// 檔案路徑: app/admin/reannotation/manage/page.js
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ManageReannotationRoundsPage() {
  const [user, setUser] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expandedRound, setExpandedRound] = useState(null);
  const [roundTasks, setRoundTasks] = useState({});
  const [showUserModal, setShowUserModal] = useState(false);
  const [modalData, setModalData] = useState(null);
  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const router = useRouter();

  const theme = {
    bg: '#ffffff',
    text: '#111827',
    border: '#e5e7eb',
    shadow: '0 1px 3px rgba(0,0,0,0.1)'
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('annotatorUser');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      if (parsedUser.role !== 'admin') {
        alert('權限不足');
        router.push('/');
      } else {
        setUser(parsedUser);
        loadRounds(parsedUser.id);
      }
    } else {
      alert('請先登入');
      router.push('/');
    }
  }, [router]);

  const loadRounds = async (userId) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reannotation/manage-rounds?userId=${userId}`);
      const result = await response.json();

      if (result.success) {
        setRounds(result.data.rounds);
      } else {
        alert(`載入失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('載入輪次失敗:', error);
      alert('載入輪次失敗');
    } finally {
      setLoading(false);
    }
  };

  const loadRoundTasks = async (roundId) => {
    try {
      const response = await fetch(`/api/reannotation/manage-tasks?userId=${user.id}&roundId=${roundId}`);
      const result = await response.json();

      if (result.success) {
        setRoundTasks(prev => ({
          ...prev,
          [roundId]: result.data.tasks
        }));
      }
    } catch (error) {
      console.error('載入任務失敗:', error);
    }
  };

  const handleDeleteRound = async (roundId, projectName, roundNumber) => {
    if (!confirm(
      `確定要刪除此輪次嗎？\n\n` +
      `專案: ${projectName}\n` +
      `輪次: Round ${roundNumber}\n\n` +
      `⚠️ 此操作會刪除該輪次的所有任務，且無法復原！`
    )) {
      return;
    }

    try {
      const response = await fetch('/api/reannotation/manage-rounds', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          roundIds: [roundId]
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('✅ 輪次已刪除');
        loadRounds(user.id);
      } else {
        alert(`刪除失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('刪除失敗:', error);
      alert('刪除失敗');
    }
  };

  const handleRemoveUsersFromRound = (roundId, projectName, roundNumber) => {
    const tasks = roundTasks[roundId] || [];
    if (tasks.length === 0) {
      alert('請先展開輪次以載入任務資料');
      return;
    }

    // 取得所有使用者及其任務數
    const userMap = {};
    tasks.forEach(task => {
      if (!userMap[task.user_id]) {
        userMap[task.user_id] = {
          id: task.user_id,
          name: task.username,
          taskCount: 0
        };
      }
      userMap[task.user_id].taskCount++;
    });

    const users = Object.values(userMap);

    // 設定模態框資料
    setModalData({
      roundId,
      projectName,
      roundNumber,
      users
    });
    setSelectedUserIds([]);
    setShowUserModal(true);
  };

  const handleConfirmRemoveUsers = async () => {
    if (selectedUserIds.length === 0) {
      alert('請至少選擇一位使用者');
      return;
    }

    if (!confirm(`確定要移除 ${selectedUserIds.length} 位使用者的所有任務嗎？`)) {
      return;
    }

    try {
      const response = await fetch('/api/reannotation/manage-rounds', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          roundId: modalData.roundId,
          action: 'remove_users',
          targetUserIds: selectedUserIds
        })
      });

      const result = await response.json();

      if (result.success) {
        alert(`✅ 已移除 ${result.deletedTasksCount} 個任務`);
        setShowUserModal(false);
        setModalData(null);
        setSelectedUserIds([]);
        loadRounds(user.id);
        loadRoundTasks(modalData.roundId);
      } else {
        alert(`移除失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('移除失敗:', error);
      alert('移除失敗');
    }
  };

  const toggleUserSelection = (userId) => {
    setSelectedUserIds(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
    });
  };

  const selectAllUsers = () => {
    if (modalData) {
      setSelectedUserIds(modalData.users.map(u => u.id));
    }
  };

  const deselectAllUsers = () => {
    setSelectedUserIds([]);
  };

  const handleToggleExpand = (roundId) => {
    if (expandedRound === roundId) {
      setExpandedRound(null);
    } else {
      setExpandedRound(roundId);
      if (!roundTasks[roundId]) {
        loadRoundTasks(roundId);
      }
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      active: { text: '進行中', color: '#3b82f6', bg: '#dbeafe' },
      completed: { text: '已完成', color: '#10b981', bg: '#d1fae5' },
      cancelled: { text: '已取消', color: '#6b7280', bg: '#f3f4f6' }
    };
    const badge = badges[status] || badges.active;

    return (
      <span style={{
        display: 'inline-block',
        padding: '6px 12px',
        borderRadius: '12px',
        fontSize: '13px',
        fontWeight: '600',
        color: badge.color,
        background: badge.bg
      }}>
        {badge.text}
      </span>
    );
  };

  const getGroupName = (taskGroup) => {
    return taskGroup === 'group1' ? 'Group 1 (承諾+時間)' : 'Group 2 (證據)';
  };

  if (!user) {
    return <div style={{ padding: '50px', textAlign: 'center' }}><h2>驗證中...</h2></div>;
  }

  return (
    <div style={{
      maxWidth: '1400px',
      margin: '0 auto',
      padding: '20px',
      background: theme.bg,
      minHeight: '100vh'
    }}>
      <style jsx>{`
        .header {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
          padding: 25px;
          border-radius: 12px;
          margin-bottom: 20px;
        }
        .panel {
          background: white;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 15px;
          box-shadow: ${theme.shadow};
        }
        .round-card {
          background: white;
          border: 2px solid ${theme.border};
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 15px;
          transition: all 0.3s;
        }
        .round-card:hover {
          border-color: #f59e0b;
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.1);
        }
        .round-card.expanded {
          border-color: #f59e0b;
          background: #fffbeb;
        }
        .btn {
          padding: 8px 16px;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        .btn-primary {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
        }
        .btn-danger {
          background: #ef4444;
          color: white;
        }
        .btn-secondary {
          background: #6b7280;
          color: white;
        }
        .btn:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        .stat-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
          gap: 15px;
          margin: 15px 0;
        }
        .stat-item {
          background: #f9fafb;
          padding: 12px;
          border-radius: 8px;
          text-align: center;
        }
        .stat-value {
          font-size: 1.5rem;
          font-weight: 700;
          color: #f59e0b;
        }
        .stat-label {
          font-size: 0.8rem;
          color: #6b7280;
          margin-top: 4px;
        }
        .user-tag {
          display: inline-block;
          padding: 4px 10px;
          background: #e5e7eb;
          border-radius: 6px;
          font-size: 12px;
          margin: 4px;
        }
        .expand-btn {
          background: none;
          border: none;
          cursor: pointer;
          font-size: 20px;
          padding: 5px 10px;
          transition: transform 0.3s;
        }
        .expand-btn.expanded {
          transform: rotate(180deg);
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 8px 0' }}>📋 重標註輪次管理</h1>
            <p style={{ margin: 0, opacity: 0.9, fontSize: '14px' }}>
              批次管理重標註輪次和任務
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn btn-secondary" onClick={() => loadRounds(user.id)}>
              🔄 重新整理
            </button>
            <button className="btn btn-secondary" onClick={() => router.push('/admin/reannotation')}>
              ← 返回
            </button>
          </div>
        </div>
      </div>

      {/* 輪次列表 */}
      <div className="panel">
        <h2 style={{ marginTop: 0, marginBottom: '20px' }}>所有重標註輪次</h2>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
            載入中...
          </div>
        ) : rounds.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#6b7280' }}>
            <div style={{ fontSize: '3rem', marginBottom: '15px' }}>📭</div>
            <h3>目前沒有重標註輪次</h3>
            <p>請前往「建立輪次」頁面建立新的重標註任務</p>
          </div>
        ) : (
          rounds.map(round => {
            const isExpanded = expandedRound === round.round_id;
            const tasks = roundTasks[round.round_id] || [];
            const userStats = {};

            tasks.forEach(task => {
              if (!userStats[task.username]) {
                userStats[task.username] = { total: 0, pending: 0, submitted: 0 };
              }
              userStats[task.username].total++;
              if (task.status === 'pending') userStats[task.username].pending++;
              if (task.status === 'submitted') userStats[task.username].submitted++;
            });

            const completionRate = round.total_tasks > 0
              ? ((round.submitted_tasks / round.total_tasks) * 100).toFixed(0)
              : 0;

            return (
              <div key={round.round_id} className={`round-card ${isExpanded ? 'expanded' : ''}`}>
                {/* 輪次標題 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                      <button
                        className={`expand-btn ${isExpanded ? 'expanded' : ''}`}
                        onClick={() => handleToggleExpand(round.round_id)}
                      >
                        ▼
                      </button>
                      <h3 style={{ margin: 0 }}>
                        {round.project_name} - Round {round.round_number}
                      </h3>
                      {getStatusBadge(round.status)}
                    </div>
                    <div style={{ marginLeft: '50px', color: '#6b7280', fontSize: '14px' }}>
                      <span>任務組: <strong>{getGroupName(round.task_group)}</strong></span>
                      <span style={{ margin: '0 15px' }}>|</span>
                      <span>門檻: <strong>{round.threshold}</strong></span>
                      <span style={{ margin: '0 15px' }}>|</span>
                      <span>建立時間: {new Date(round.created_at).toLocaleDateString('zh-TW')}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleRemoveUsersFromRound(round.round_id, round.project_name, round.round_number)}
                    >
                      👥 移除使用者
                    </button>
                    <button
                      className="btn btn-danger"
                      onClick={() => handleDeleteRound(round.round_id, round.project_name, round.round_number)}
                    >
                      🗑️ 刪除輪次
                    </button>
                  </div>
                </div>

                {/* 統計資訊 */}
                <div className="stat-grid">
                  <div className="stat-item">
                    <div className="stat-value">{round.total_tasks}</div>
                    <div className="stat-label">總任務數</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{round.total_items}</div>
                    <div className="stat-label">資料筆數</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{round.total_users}</div>
                    <div className="stat-label">使用者數</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value" style={{ color: '#f59e0b' }}>{round.pending_tasks}</div>
                    <div className="stat-label">待處理</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value" style={{ color: '#10b981' }}>{round.submitted_tasks}</div>
                    <div className="stat-label">已完成</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{completionRate}%</div>
                    <div className="stat-label">完成率</div>
                  </div>
                </div>

                {/* 展開詳細資訊 */}
                {isExpanded && (
                  <div style={{
                    marginTop: '20px',
                    paddingTop: '20px',
                    borderTop: `2px solid ${theme.border}`
                  }}>
                    <h4 style={{ marginTop: 0 }}>👥 使用者任務分佈</h4>
                    {Object.keys(userStats).length === 0 ? (
                      <p style={{ color: '#6b7280' }}>載入中...</p>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '15px' }}>
                        {Object.entries(userStats).map(([username, stats]) => (
                          <div key={username} style={{
                            background: '#f9fafb',
                            padding: '15px',
                            borderRadius: '8px',
                            border: `1px solid ${theme.border}`
                          }}>
                            <div style={{ fontWeight: 'bold', marginBottom: '10px', color: theme.text }}>
                              👤 {username.split('@')[0]}
                            </div>
                            <div style={{ fontSize: '13px', color: '#6b7280' }}>
                              <div>總任務: <strong>{stats.total}</strong></div>
                              <div>待處理: <strong style={{ color: '#f59e0b' }}>{stats.pending}</strong></div>
                              <div>已完成: <strong style={{ color: '#10b981' }}>{stats.submitted}</strong></div>
                              <div style={{ marginTop: '8px' }}>
                                完成率: <strong>{stats.total > 0 ? ((stats.submitted / stats.total) * 100).toFixed(0) : 0}%</strong>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 使用者選擇模態框 */}
      {showUserModal && modalData && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div style={{
            background: 'white',
            borderRadius: '12px',
            padding: '30px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflow: 'auto',
            boxShadow: '0 10px 40px rgba(0,0,0,0.3)'
          }}>
            <h2 style={{ marginTop: 0, marginBottom: '10px', color: theme.text }}>
              從 {modalData.projectName} Round {modalData.roundNumber} 移除使用者
            </h2>
            <p style={{ color: '#6b7280', marginBottom: '20px' }}>
              請選擇要移除的使用者，已選擇 {selectedUserIds.length} 位使用者
            </p>

            {/* 全選/取消全選按鈕 */}
            <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
              <button
                className="btn btn-secondary"
                onClick={selectAllUsers}
                style={{ fontSize: '13px', padding: '6px 12px' }}
              >
                ✓ 全選
              </button>
              <button
                className="btn btn-secondary"
                onClick={deselectAllUsers}
                style={{ fontSize: '13px', padding: '6px 12px' }}
              >
                ✗ 取消全選
              </button>
            </div>

            {/* 使用者列表 */}
            <div style={{ marginBottom: '25px' }}>
              {modalData.users.map(user => {
                const isSelected = selectedUserIds.includes(user.id);
                return (
                  <div
                    key={user.id}
                    onClick={() => toggleUserSelection(user.id)}
                    style={{
                      padding: '15px',
                      marginBottom: '10px',
                      border: `2px solid ${isSelected ? '#f59e0b' : theme.border}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: isSelected ? '#fffbeb' : 'white',
                      transition: 'all 0.2s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '24px',
                        height: '24px',
                        border: `2px solid ${isSelected ? '#f59e0b' : '#d1d5db'}`,
                        borderRadius: '6px',
                        background: isSelected ? '#f59e0b' : 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: 'bold'
                      }}>
                        {isSelected && '✓'}
                      </div>
                      <div>
                        <div style={{ fontWeight: '600', color: theme.text }}>
                          {user.name}
                        </div>
                        <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '2px' }}>
                          {user.taskCount} 個任務
                        </div>
                      </div>
                    </div>
                    {isSelected && (
                      <span style={{
                        background: '#f59e0b',
                        color: 'white',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: '600'
                      }}>
                        已選擇
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 操作按鈕 */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  setShowUserModal(false);
                  setModalData(null);
                  setSelectedUserIds([]);
                }}
              >
                取消
              </button>
              <button
                className="btn btn-danger"
                onClick={handleConfirmRemoveUsers}
                disabled={selectedUserIds.length === 0}
                style={{ opacity: selectedUserIds.length === 0 ? 0.5 : 1 }}
              >
                確認移除 ({selectedUserIds.length})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
