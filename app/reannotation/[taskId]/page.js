// 檔案路徑: app/reannotation/[taskId]/page.js
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const PDFViewer = dynamic(() => import('../../../components/PDFViewer'), {
  ssr: false,
  loading: () => <div className="pdf-status">正在載入 PDF 瀏覽器...</div>
});

export default function ReannotationDetailPage() {
  const params = useParams();
  const taskId = params.taskId;
  const router = useRouter();

  const [user, setUser] = useState(null);
  const [taskData, setTaskData] = useState(null);
  const [guidelines, setGuidelines] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 表單狀態
  const [formData, setFormData] = useState({
    promise_status: '',
    verification_timeline: '',
    evidence_status: '',
    evidence_quality: '',
    promise_string: '',
    evidence_string: ''
  });
  const [persistAnswer, setPersistAnswer] = useState(false);
  const [comment, setComment] = useState('');

  const theme = {
    bg: '#ffffff',
    bgPanel: '#ffffff',
    text: '#111827',
    textSecondary: '#6b7280',
    border: '#e5e7eb',
    borderLight: '#f3f4f6',
    shadow: '0 1px 3px rgba(0,0,0,0.1)',
    warningBg: '#fef3c7',
    warningBorder: '#f59e0b',
    dangerBg: '#fee2e2',
    dangerBorder: '#ef4444',
    successBg: '#d1fae5',
    successBorder: '#10b981'
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('annotatorUser');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser);
      loadTaskData(parsedUser.id);
    } else {
      alert('請先登入');
      router.push('/');
    }
  }, [taskId, router]);

  const loadTaskData = async (userId) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/reannotation/queue?userId=${userId}`);
      const result = await response.json();

      if (result.success) {
        // 從所有任務中找到當前任務
        const allTasks = result.data.tasks.flatMap(group => group.tasks);
        const currentTask = allTasks.find(t => t.taskId === parseInt(taskId));

        if (currentTask) {
          setTaskData(currentTask);
          setGuidelines(result.data.guidelines);

          // 初始化表單資料
          setFormData({
            promise_status: currentTask.currentAnswers.promise_status || '',
            verification_timeline: currentTask.currentAnswers.verification_timeline || '',
            evidence_status: currentTask.currentAnswers.evidence_status || '',
            evidence_quality: currentTask.currentAnswers.evidence_quality || '',
            promise_string: currentTask.currentAnswers.promise_string || '',
            evidence_string: currentTask.currentAnswers.evidence_string || ''
          });
          setPersistAnswer(currentTask.persistAnswer || false);
          setComment(currentTask.comment || '');
        } else {
          alert('找不到此任務');
          router.push('/reannotation');
        }
      }
    } catch (error) {
      console.error('載入任務失敗:', error);
      alert('載入任務失敗');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!taskData) return;

    // 驗證必填欄位
    const flaggedTasks = Object.keys(taskData.tasksFlagged);
    const missingFields = [];

    if (flaggedTasks.includes('promise_status') && !formData.promise_status) {
      missingFields.push('承諾狀態');
    }
    if (flaggedTasks.includes('verification_timeline') && !formData.verification_timeline) {
      missingFields.push('驗證時間軸');
    }
    if (flaggedTasks.includes('evidence_status') && !formData.evidence_status) {
      missingFields.push('證據狀態');
    }
    if (flaggedTasks.includes('evidence_quality') && !formData.evidence_quality) {
      missingFields.push('證據品質');
    }

    if (missingFields.length > 0) {
      alert(`請填寫以下欄位: ${missingFields.join(', ')}`);
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch('/api/reannotation/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: parseInt(taskId),
          userId: user.id,
          sourceDataId: taskData.sourceDataId,
          answers: formData,
          persistAnswer,
          comment
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('✅ 重標註已成功送出！');
        router.push('/reannotation');
      } else {
        alert(`送出失敗: ${result.error}`);
      }
    } catch (error) {
      console.error('送出失敗:', error);
      alert('送出失敗');
    } finally {
      setSubmitting(false);
    }
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

  if (loading || !taskData) {
    return (
      <div style={{ padding: '50px', textAlign: 'center' }}>
        <h2>載入中...</h2>
      </div>
    );
  }

  const taskGroup = Object.keys(taskData.tasksFlagged)[0].includes('promise') ||
                    Object.keys(taskData.tasksFlagged)[0].includes('verification')
                    ? 'group1' : 'group2';

  const currentGuidelines = guidelines?.[taskGroup] || {};

  return (
    <div style={{
      maxWidth: '1600px',
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
          padding: 25px;
          border-radius: 12px;
          margin-bottom: 20px;
        }
        .panel {
          background: ${theme.bgPanel};
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 15px;
          box-shadow: ${theme.shadow};
        }
        .warning-panel {
          background: ${theme.warningBg};
          border: 2px solid ${theme.warningBorder};
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 20px;
        }
        .guideline-panel {
          background: #eff6ff;
          border: 2px solid #3b82f6;
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 20px;
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
          padding: 10px 12px;
          border: 2px solid ${theme.border};
          border-radius: 8px;
          font-size: 14px;
          transition: all 0.3s;
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
        .score-badge {
          display: inline-block;
          padding: 6px 12px;
          background: ${theme.dangerBg};
          color: ${theme.dangerBorder};
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          margin-left: 10px;
        }
        .checkbox-container {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          background: ${theme.borderLight};
          border-radius: 8px;
          margin-bottom: 15px;
        }
        .guideline-list {
          list-style: none;
          padding: 0;
          margin: 10px 0 0 0;
        }
        .guideline-list li {
          padding: 8px 0 8px 20px;
          position: relative;
          color: #1e40af;
          line-height: 1.6;
        }
        .guideline-list li:before {
          content: "▸";
          position: absolute;
          left: 0;
          color: #3b82f6;
          font-weight: bold;
        }
        .two-column-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        @media (max-width: 1024px) {
          .two-column-layout {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 8px 0' }}>🔄 重標註任務 #{taskData.sourceDataId}</h1>
            <p style={{ margin: 0, opacity: 0.9, fontSize: '14px' }}>
              頁碼: {taskData.pageNumber}
            </p>
          </div>
          <button className="btn btn-secondary" onClick={() => router.push('/reannotation')}>
            ← 返回列表
          </button>
        </div>
      </div>

      <div className="two-column-layout">
        {/* 左側：PDF + 原始文本 */}
        <div>
          {/* PDF Viewer */}
          {taskData.sourceUrl && (
            <div className="panel" style={{ minHeight: '600px' }}>
              <h3 style={{ marginTop: 0 }}>📄 PDF 預覽</h3>
              <PDFViewer pdfUrl={taskData.sourceUrl} />
            </div>
          )}

          {/* 原始文本 */}
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>📝 永續承諾文本</h3>
            <p style={{ lineHeight: '1.8', color: theme.text, fontSize: '15px' }}>
              {taskData.originalData}
            </p>
          </div>
        </div>

        {/* 右側：標註指引 + 表單 */}
        <div>
          {/* 警告面板 */}
          <div className="warning-panel">
            <h3 style={{ marginTop: 0, color: theme.warningBorder }}>
              ⚠️ 以下項目一致性較低，需要重新檢視
            </h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '15px' }}>
              {Object.entries(taskData.tasksFlagged).map(([taskKey, score]) => (
                <div key={taskKey} style={{
                  padding: '10px 15px',
                  background: theme.dangerBg,
                  border: `2px solid ${theme.dangerBorder}`,
                  borderRadius: '8px',
                  fontWeight: '600'
                }}>
                  {getTaskName(taskKey)}
                  <span className="score-badge" style={{ marginLeft: '8px' }}>
                    α = {score.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 標註指引 */}
          <div className="guideline-panel">
            <h3 style={{ marginTop: 0, color: '#1e40af' }}>📖 標註指引</h3>
            {Object.entries(currentGuidelines).map(([taskKey, guideline]) => (
              <div key={taskKey} style={{ marginBottom: '20px' }}>
                <h4 style={{ color: '#1e40af', marginBottom: '8px' }}>{guideline.title}</h4>
                <ul className="guideline-list">
                  {guideline.items.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* 標註表單 */}
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>✏️ 重新標註</h3>

            {/* Group 1: 承諾狀態 + 驗證時間 */}
            {taskData.tasksFlagged.promise_status !== undefined && (
              <div className="form-group">
                <label className="form-label">
                  承諾狀態 *
                  {taskData.tasksFlagged.promise_status !== undefined && (
                    <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.promise_status.toFixed(2)})</span>
                  )}
                </label>
                <select
                  className="form-control"
                  value={formData.promise_status}
                  onChange={(e) => setFormData({ ...formData, promise_status: e.target.value })}
                >
                  <option value="">請選擇...</option>
                  <option value="Yes">Yes - 有明確承諾</option>
                  <option value="No">No - 無明確承諾</option>
                </select>
              </div>
            )}

            {taskData.tasksFlagged.verification_timeline !== undefined && (
              <div className="form-group">
                <label className="form-label">
                  驗證時間軸 *
                  {taskData.tasksFlagged.verification_timeline !== undefined && (
                    <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.verification_timeline.toFixed(2)})</span>
                  )}
                </label>
                <select
                  className="form-control"
                  value={formData.verification_timeline}
                  onChange={(e) => setFormData({ ...formData, verification_timeline: e.target.value })}
                >
                  <option value="">請選擇...</option>
                  <option value="within_2_years">2年內可驗證</option>
                  <option value="between_2_and_5_years">2-5年內可驗證</option>
                  <option value="longer_than_5_years">5年以上</option>
                  <option value="already">已經實現/持續進行中</option>
                </select>
              </div>
            )}

            {/* Group 2: 證據狀態 + 品質 */}
            {taskData.tasksFlagged.evidence_status !== undefined && (
              <div className="form-group">
                <label className="form-label">
                  證據狀態 *
                  {taskData.tasksFlagged.evidence_status !== undefined && (
                    <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.evidence_status.toFixed(2)})</span>
                  )}
                </label>
                <select
                  className="form-control"
                  value={formData.evidence_status}
                  onChange={(e) => setFormData({ ...formData, evidence_status: e.target.value })}
                >
                  <option value="">請選擇...</option>
                  <option value="Yes">Yes - 有提供證據</option>
                  <option value="No">No - 未提供證據</option>
                </select>
              </div>
            )}

            {taskData.tasksFlagged.evidence_quality !== undefined && (
              <div className="form-group">
                <label className="form-label">
                  證據品質 *
                  {taskData.tasksFlagged.evidence_quality !== undefined && (
                    <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.evidence_quality.toFixed(2)})</span>
                  )}
                </label>
                <select
                  className="form-control"
                  value={formData.evidence_quality}
                  onChange={(e) => setFormData({ ...formData, evidence_quality: e.target.value })}
                >
                  <option value="">請選擇...</option>
                  <option value="Clear">Clear - 證據明確</option>
                  <option value="Not Clear">Not Clear - 證據不明確</option>
                  <option value="Misleading">Misleading - 證據具誤導性</option>
                </select>
              </div>
            )}

            {/* 堅持答案選項 */}
            <div className="checkbox-container">
              <input
                type="checkbox"
                id="persistAnswer"
                checked={persistAnswer}
                onChange={(e) => setPersistAnswer(e.target.checked)}
              />
              <label htmlFor="persistAnswer" style={{ margin: 0, cursor: 'pointer', fontWeight: '600' }}>
                ✋ 我仍堅持我的原始答案
              </label>
            </div>

            {/* 備註 */}
            <div className="form-group">
              <label className="form-label">備註 (選填)</label>
              <textarea
                className="form-control"
                rows="3"
                placeholder="說明為何修改或堅持原答案..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {/* 送出按鈕 */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '25px' }}>
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={submitting}
                style={{ flex: 1 }}
              >
                {submitting ? '送出中...' : '✓ 送出重標註'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => router.push('/reannotation')}
                disabled={submitting}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
