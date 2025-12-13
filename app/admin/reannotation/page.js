// 檔案路徑: app/admin/reannotation/page.js
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminReannotationPage() {
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [selectedProject, setSelectedProject] = useState(null);
  const [taskGroup, setTaskGroup] = useState('group1');
  const [threshold, setThreshold] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
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
        alert('權限不足，將返回主頁面');
        router.push('/');
      } else {
        setUser(parsedUser);
        loadProjects();
      }
    } else {
      alert('請先登入');
      router.push('/');
    }
  }, [router]);

  const loadProjects = async () => {
    try {
      // 載入已完成標註的專案
      const savedUser = JSON.parse(localStorage.getItem('annotatorUser'));
      const response = await fetch('/api/get-completed-projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: savedUser.id })
      });

      const result = await response.json();
      if (result.success) {
        setProjects(result.projects);
      }
    } catch (error) {
      console.error('載入專案失敗:', error);
    }
  };

  const handleCreateRound = async () => {
    if (!selectedProject) {
      alert('請選擇專案');
      return;
    }

    if (!confirm(
      `確定要建立新的重標註輪次嗎？\n\n` +
      `專案: ${projects.find(p => p.id === selectedProject)?.name}\n` +
      `任務組別: ${taskGroup === 'group1' ? '承諾與時間軸' : '證據狀態與品質'}\n` +
      `一致性門檻: ${threshold}\n\n` +
      `系統將自動分析標註資料並分配重標註任務給相關使用者。`
    )) {
      return;
    }

    setLoading(true);
    setMessage('正在計算一致性並建立任務...');

    try {
      const response = await fetch('/api/reannotation/create-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          projectId: selectedProject,
          taskGroup,
          threshold,
          assignAll: true
        })
      });

      const result = await response.json();

      if (result.success) {
        if (result.data.inconsistentCount === 0) {
          alert(`✅ ${result.message || '所有標註一致性都很好！'}`);
        } else {
          alert(
            `✅ 重標註輪次建立成功！\n\n` +
            `輪次編號: Round ${result.data.roundNumber}\n` +
            `任務組別: ${taskGroup === 'group1' ? '承諾與時間軸' : '證據狀態與品質'}\n` +
            `需重新檢視的資料: ${result.data.inconsistentCount} 筆\n` +
            `建立的任務數: ${result.data.tasksCreated} 個\n` +
            `一致性門檻: ${threshold}\n\n` +
            `已通知相關使用者進行重標註。`
          );
        }
        setMessage('');
      } else {
        alert(`建立失敗: ${result.error}`);
        setMessage('');
      }
    } catch (error) {
      console.error('建立輪次失敗:', error);
      alert('建立失敗');
      setMessage('');
    } finally {
      setLoading(false);
    }
  };

  if (!user) {
    return <div style={{ padding: '50px', textAlign: 'center' }}><h2>驗證中...</h2></div>;
  }

  return (
    <div style={{
      maxWidth: '1200px',
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
          background: white;
          border-radius: 12px;
          padding: 25px;
          margin-bottom: 20px;
          box-shadow: ${theme.shadow};
        }
        .form-group {
          margin-bottom: 20px;
        }
        .form-label {
          display: block;
          font-weight: 600;
          margin-bottom: 8px;
          color: ${theme.text};
        }
        .form-control {
          width: 100%;
          padding: 12px;
          border: 2px solid ${theme.border};
          border-radius: 8px;
          font-size: 14px;
        }
        .form-control:focus {
          outline: none;
          border-color: #f59e0b;
          box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
        }
        .btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
        }
        .btn-primary {
          background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
          color: white;
        }
        .btn-primary:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 4px 12px rgba(245, 158, 11, 0.4);
        }
        .btn-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-secondary {
          background: #6b7280;
          color: white;
        }
        .btn-secondary:hover {
          background: #4b5563;
        }
        .info-box {
          background: #eff6ff;
          border: 2px solid #3b82f6;
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 20px;
        }
        .warning-box {
          background: #fef3c7;
          border: 2px solid #f59e0b;
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 20px;
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 10px 0' }}>🔄 重標註管理</h1>
            <p style={{ margin: 0, opacity: 0.9 }}>
              建立新的重標註輪次，分配一致性較低的任務給標註者
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              className="btn btn-primary"
              onClick={() => router.push('/admin/reannotation/manage')}
              style={{ background: '#3b82f6' }}
            >
              📋 管理現有任務
            </button>
            <button className="btn btn-secondary" onClick={() => router.push('/admin')}>
              ← 返回管理頁面
            </button>
          </div>
        </div>
      </div>

      {/* 說明區塊 */}
      <div className="info-box">
        <h3 style={{ marginTop: 0, color: '#1e40af' }}>📖 功能說明</h3>
        <ul style={{ lineHeight: '1.8', color: '#1e3a8a', marginBottom: 0 }}>
          <li><strong>任務分組策略</strong>：將四個標註項目分為兩組，避免標註者混亂
            <ul>
              <li><strong>Group 1 (承諾與時間軸)</strong>：promise_status + verification_timeline</li>
              <li><strong>Group 2 (證據狀態與品質)</strong>：evidence_status + evidence_quality</li>
            </ul>
          </li>
          <li><strong>一致性門檻</strong>：Local Alpha 分數低於此門檻的資料將被標記為需重新檢視</li>
          <li><strong>任務分配</strong>：系統將自動為所有相關標註者建立重標註任務</li>
          <li><strong>不顯示他人答案</strong>：標註者只能看到統計資訊和標註指引，無法看到其他人的逐筆答案</li>
        </ul>
      </div>

      {/* 建立輪次表單 */}
      <div className="panel">
        <h2 style={{ marginTop: 0 }}>建立新輪次</h2>

        <div className="form-group">
          <label className="form-label">選擇專案 *</label>
          <select
            className="form-control"
            value={selectedProject || ''}
            onChange={(e) => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
          >
            <option value="">請選擇專案...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.users_completed} 位使用者完成，共 {p.total_tasks} 題)
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">任務組別 *</label>
          <select
            className="form-control"
            value={taskGroup}
            onChange={(e) => setTaskGroup(e.target.value)}
          >
            <option value="group1">Group 1 - 承諾與時間軸 (promise_status + verification_timeline)</option>
            <option value="group2">Group 2 - 證據狀態與品質 (evidence_status + evidence_quality)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">一致性門檻 (Local Alpha) *</label>
          <input
            type="number"
            className="form-control"
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value))}
            min="0"
            max="1"
            step="0.05"
          />
          <small style={{ color: '#6b7280', display: 'block', marginTop: '8px' }}>
            分數低於此門檻的資料將被標記為需重新檢視（建議值：0.5）
          </small>
        </div>

        {message && (
          <div className="warning-box">
            <p style={{ margin: 0, fontWeight: '600', color: '#92400e' }}>
              ⏳ {message}
            </p>
          </div>
        )}

        <button
          className="btn btn-primary"
          onClick={handleCreateRound}
          disabled={loading || !selectedProject}
          style={{ marginRight: '10px' }}
        >
          {loading ? '建立中...' : '✓ 建立重標註輪次'}
        </button>

        <button
          className="btn btn-secondary"
          onClick={() => router.push('/admin')}
          disabled={loading}
        >
          取消
        </button>
      </div>

      {/* 使用提示 */}
      <div className="panel">
        <h3 style={{ marginTop: 0, color: theme.text }}>💡 使用流程</h3>
        <ol style={{ lineHeight: '2', color: '#374151' }}>
          <li>選擇已完成標註的專案</li>
          <li>選擇要重標註的任務組別（建議先進行 Group 1，再進行 Group 2）</li>
          <li>設定一致性門檻（預設 0.5）</li>
          <li>點擊「建立重標註輪次」，系統將自動：
            <ul>
              <li>計算每筆資料的 Local Alpha 分數</li>
              <li>找出分數低於門檻的資料</li>
              <li>為所有相關標註者建立重標註任務</li>
            </ul>
          </li>
          <li>標註者登入後可在主頁面看到重標註任務提示，或直接前往 <a href="/reannotation" style={{ color: '#f59e0b', fontWeight: '600' }}>/reannotation</a> 查看</li>
          <li>標註者完成重標註後，系統會記錄變更並更新版本號</li>
          <li>管理員可重複此流程，直到一致性達到理想水準</li>
        </ol>
      </div>
    </div>
  );
}
