// 檔案路徑: app/reannotation/[taskId]/page.js
'use client';

import { useState, useEffect, useRef } from 'react';
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
  const [groupData, setGroupData] = useState(null); // 保存 group 資訊（包含 groupRoundNumber）
  const [guidelines, setGuidelines] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 文本區域 ref（用於標記功能）
  const dataTextRef = useRef(null);

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
        // 找到包含當前任務的 group
        let currentTaskGroup = null;
        let currentTask = null;

        for (const group of result.data.tasks) {
          const task = group.tasks.find(t => t.taskId === parseInt(taskId));
          if (task) {
            currentTask = task;
            currentTaskGroup = group;
            break;
          }
        }

        if (currentTask && currentTaskGroup) {
          setTaskData(currentTask);
          setGroupData(currentTaskGroup); // 保存 group 資訊
          setGuidelines(result.data.guidelines);

          const initialFormData = {
            promise_status: currentTask.currentAnswers.promise_status || '',
            verification_timeline: currentTask.currentAnswers.verification_timeline || '',
            evidence_status: currentTask.currentAnswers.evidence_status || '',
            evidence_quality: currentTask.currentAnswers.evidence_quality || '',
            promise_string: currentTask.currentAnswers.promise_string || '',
            evidence_string: currentTask.currentAnswers.evidence_string || ''
          };
          setFormData(initialFormData);
          setPersistAnswer(currentTask.persistAnswer || false);
          setComment(currentTask.comment || '');

          setTimeout(() => {
            restoreHighlights(initialFormData.promise_string, initialFormData.evidence_string, currentTask.originalData);
          }, 100);
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
    updateHighlightStrings();
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

    const fragment = range.cloneContents();
    const highlights = fragment.querySelectorAll('.highlight-promise, .highlight-evidence');

    if (highlights.length === 0) {
      let node = range.commonAncestorContainer;
      if (node.nodeType === Node.TEXT_NODE) {
        node = node.parentElement;
      }

      const highlightParent = node.closest('.highlight-promise, .highlight-evidence');
      if (highlightParent) {
        const text = highlightParent.textContent;
        highlightParent.replaceWith(document.createTextNode(text));
        selection.removeAllRanges();
        updateHighlightStrings();
        return;
      }

      alert('選取範圍內沒有找到標記');
      return;
    }

    const allHighlights = container.querySelectorAll('.highlight-promise, .highlight-evidence');
    allHighlights.forEach(highlight => {
      if (range.intersectsNode(highlight)) {
        const text = highlight.textContent;
        highlight.replaceWith(document.createTextNode(text));
      }
    });

    selection.removeAllRanges();
    updateHighlightStrings();
  };

  const updateHighlightStrings = () => {
    if (!dataTextRef.current) return;

    const promiseString = getHighlightedText('promise');
    const evidenceString = getHighlightedText('evidence');

    setFormData(prev => ({
      ...prev,
      promise_string: promiseString,
      evidence_string: evidenceString
    }));
  };

  const getHighlightedText = (type) => {
    if (!dataTextRef.current) return '';

    const positions = [];
    const highlights = dataTextRef.current.querySelectorAll(`.highlight-${type}`);

    highlights.forEach(el => {
      const range = document.createRange();
      range.selectNodeContents(dataTextRef.current);

      const preRange = range.cloneRange();
      preRange.setEnd(el.firstChild || el, 0);
      const startOffset = preRange.toString().length;
      const endOffset = startOffset + el.textContent.length;

      positions.push(`${startOffset}-${endOffset}`);
    });

    return positions.join(',');
  };

  const restoreHighlights = (promiseString, evidenceString, originalData) => {
    if (!dataTextRef.current || !originalData) return;

    dataTextRef.current.textContent = originalData;
    const plainText = dataTextRef.current.textContent;

    if (promiseString && promiseString.includes('-')) {
      highlightByPositions(promiseString, 'promise', plainText);
    }

    if (evidenceString && evidenceString.includes('-')) {
      highlightByPositions(evidenceString, 'evidence', plainText);
    }
  };

  const highlightByPositions = (positionsStr, type, plainText) => {
    if (!dataTextRef.current || !positionsStr) return;

    const positions = positionsStr.split(',').map(pos => {
      const [start, end] = pos.split('-').map(Number);
      return { start, end };
    });

    positions.sort((a, b) => b.start - a.start);

    positions.forEach(({ start, end }) => {
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

        if (start >= nodeStart && end <= nodeEnd) {
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

  const handleSubmit = async () => {
    if (!taskData) return;

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
      // 第1步：送出重標註
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
        // 第2步：等待一致性分數計算完成（使用 groupData.projectId）
        if (groupData && groupData.projectId) {
          try {
            console.log('📊 正在重新計算一致性分數...');
            const consistencyResponse = await fetch(`/api/consistency?projectId=${groupData.projectId}&userId=${user.id}`);
            const consistencyResult = await consistencyResponse.json();

            if (consistencyResult.success) {
              console.log('✓ 一致性分數已更新');
            } else {
              console.warn('⚠️ 一致性計算失敗:', consistencyResult.error);
            }
          } catch (err) {
            console.warn('⚠️ 一致性計算觸發失敗:', err);
          }
        }

        alert('✅ 重標註已成功送出！一致性分數已更新。');
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

  const getVerificationTimelineLabel = (value) => {
    const labels = {
      'within_2_years': '2年內',
      'between_2_and_5_years': '2-5年',
      'longer_than_5_years': '5年以上',
      'already': '已執行',
      'N/A': 'N/A'
    };
    return labels[value] || value || '未填寫';
  };

  if (loading || !taskData) {
    return (
      <div className="container">
        <div className="panel" style={{ textAlign: 'center', padding: '50px' }}>
          <h2>載入中...</h2>
        </div>
      </div>
    );
  }

  const taskGroup = Object.keys(taskData.tasksFlagged)[0].includes('promise') ||
                    Object.keys(taskData.tasksFlagged)[0].includes('verification')
                    ? 'group1' : 'group2';

  const currentGuidelines = guidelines?.[taskGroup] || {};

  return (
    <div className="container">
      <style jsx global>{`
        .warning-box {
          background: #fef3c7;
          border: 2px solid #f59e0b;
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 20px;
        }
        .score-badge {
          display: inline-block;
          padding: 4px 8px;
          background: #fee2e2;
          color: #dc2626;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          margin-left: 8px;
        }
        .guideline-box {
          background: #eff6ff;
          border: 2px solid #3b82f6;
          border-radius: 8px;
          padding: 15px;
          margin-bottom: 15px;
        }
        .guideline-box h4 {
          color: #1e40af;
          margin-bottom: 8px;
          font-size: 15px;
        }
        .guideline-box ul {
          list-style: none;
          padding: 0;
          margin: 10px 0 0 0;
        }
        .guideline-box li {
          padding: 6px 0 6px 20px;
          position: relative;
          color: #1e40af;
          line-height: 1.6;
          font-size: 14px;
        }
        .guideline-box li:before {
          content: "▸";
          position: absolute;
          left: 0;
          color: #3b82f6;
          font-weight: bold;
        }
        .checkbox-container-persist {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          background: #f3f4f6;
          border-radius: 8px;
          margin-bottom: 15px;
        }
      `}</style>

      {/* Header */}
      <div className="header" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h1 style={{ margin: '0 0 8px 0', fontSize: '24px' }}>🔄 重標註任務 #{taskData.sourceDataId}</h1>
            <p style={{ margin: 0, opacity: 0.9, fontSize: '14px' }}>
              頁碼: {taskData.pageNumber} | {taskGroup === 'group1' ? '承諾與時間軸' : '證據狀態與品質'} |
              第 {groupData?.groupRoundNumber || 1} 次重標註
              <span style={{ opacity: 0.7, fontSize: '12px', marginLeft: '4px' }}>
                (整體 Round {groupData?.roundNumber || 1})
              </span>
            </p>
          </div>
          <button className="btn" style={{ background: '#6b7280', color: 'white' }} onClick={() => router.push('/reannotation')}>
            ← 返回列表
          </button>
        </div>
      </div>

      {/* 警告面板 */}
      <div className="warning-box">
        <h3 style={{ marginTop: 0, color: '#d97706', fontSize: '16px' }}>
          ⚠️ 以下項目一致性較低，需要重新檢視
        </h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '15px' }}>
          {Object.entries(taskData.tasksFlagged).map(([taskKey, score]) => (
            <div key={taskKey} style={{
              padding: '10px 15px',
              background: '#fee2e2',
              border: '2px solid #dc2626',
              borderRadius: '8px',
              fontWeight: '600',
              fontSize: '14px'
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
      {Object.keys(currentGuidelines).length > 0 && (
        <div className="guideline-box">
          <h3 style={{ marginTop: 0, color: '#1e40af', fontSize: '16px' }}>📖 標註指引</h3>
          {Object.entries(currentGuidelines).map(([taskKey, guideline]) => (
            <div key={taskKey} style={{ marginBottom: '15px' }}>
              <h4>{guideline.title}</h4>
              <ul>
                {guideline.items.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* 主要內容區 - 兩欄式布局 */}
      <div className="content">
        <div className="content-top">
          {/* 左側：文本內容 */}
          <div className="panel">
            <h2>文本內容 (ID: {taskData.sourceDataId}, 頁碼: {taskData.pageNumber})</h2>
            <div className="info-box">
              {taskGroup === 'group1'
                ? '用滑鼠選取文字後點擊「標記承諾」按鈕，將文字標記為黃色'
                : '用滑鼠選取文字後點擊「標記證據」按鈕，將文字標記為藍色'}
            </div>
            <div ref={dataTextRef} className="text-area">{taskData.originalData}</div>
            <div className="highlight-btns">
              {taskGroup === 'group1' && (
                <button className="highlight-btn highlight-btn-promise" onClick={() => highlightSelection('promise')}>
                  標記承諾
                </button>
              )}
              {taskGroup === 'group2' && (
                <button className="highlight-btn highlight-btn-evidence" onClick={() => highlightSelection('evidence')}>
                  標記證據
                </button>
              )}
              <button className="highlight-btn highlight-btn-clear" onClick={clearSelectedHighlights}>
                清除標記
              </button>
            </div>
          </div>

          {/* 右側：標註欄位 */}
          <div className="panel">
            <h2>標註欄位</h2>

            {/* 如果是 Group 2，先顯示 Group 1 的內容（只讀） */}
            {taskGroup === 'group2' && (
              <div style={{
                marginBottom: '25px',
                padding: '15px',
                background: '#f9fafb',
                border: '2px solid #e5e7eb',
                borderRadius: '8px'
              }}>
                <h3 style={{ margin: '0 0 15px 0', color: '#6b7280', fontSize: '16px' }}>
                  📋 Group 1 標註內容（參考）
                </h3>
                <div style={{ display: 'grid', gap: '12px' }}>
                  <div className="field">
                    <label style={{ color: '#6b7280' }}>承諾狀態</label>
                    <input
                      type="text"
                      value={formData.promise_status || '未填寫'}
                      disabled
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        background: '#f3f4f6',
                        color: '#374151',
                        cursor: 'not-allowed'
                      }}
                    />
                  </div>
                  <div className="field">
                    <label style={{ color: '#6b7280' }}>驗證時間軸</label>
                    <input
                      type="text"
                      value={getVerificationTimelineLabel(formData.verification_timeline)}
                      disabled
                      style={{
                        width: '100%',
                        padding: '8px 12px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        background: '#f3f4f6',
                        color: '#374151',
                        cursor: 'not-allowed'
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Group 1: 承諾狀態 + 驗證時間軸 */}
            {taskData.tasksFlagged.promise_status !== undefined && (
              <div className="field">
                <label>
                  承諾狀態
                  <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.promise_status.toFixed(2)})</span>
                </label>
                <select
                  value={formData.promise_status}
                  onChange={(e) => {
                    const newStatus = e.target.value;
                    let newTimeline = formData.verification_timeline;

                    if (newStatus === 'No') {
                      // 選擇 No 時，驗證時間軸設為 N/A
                      newTimeline = 'N/A';
                    } else if (newStatus === 'Yes' && formData.verification_timeline === 'N/A') {
                      // 選擇 Yes 時，如果驗證時間軸是 N/A，則清空
                      newTimeline = '';
                    }

                    setFormData({
                      ...formData,
                      promise_status: newStatus,
                      verification_timeline: newTimeline
                    });
                  }}
                >
                  <option value="">請選擇</option>
                  <option value="Yes">Yes</option>
                  <option value="No">No</option>
                </select>
              </div>
            )}

            {taskData.tasksFlagged.verification_timeline !== undefined && (
              <div className="field">
                <label>
                  驗證時間軸
                  <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.verification_timeline.toFixed(2)})</span>
                </label>
                <select
                  value={formData.verification_timeline}
                  onChange={(e) => setFormData({ ...formData, verification_timeline: e.target.value })}
                  disabled={formData.promise_status === 'No'}
                >
                  {formData.promise_status === 'No' ? (
                    <option value="N/A">N/A</option>
                  ) : (
                    <>
                      <option value="">請選擇</option>
                      <option value="within_2_years">2年內</option>
                      <option value="between_2_and_5_years">2-5年</option>
                      <option value="longer_than_5_years">5年以上</option>
                      <option value="already">已執行</option>
                      {formData.promise_status !== 'Yes' && <option value="N/A">N/A</option>}
                    </>
                  )}
                </select>
              </div>
            )}

            {/* Group 2: 證據狀態 + 品質 */}
            {taskData.tasksFlagged.evidence_status !== undefined && (
              <div className="field">
                <label>
                  證據狀態
                  <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.evidence_status.toFixed(2)})</span>
                </label>
                <select
                  value={formData.evidence_status}
                  onChange={(e) => {
                    const newEvidenceStatus = e.target.value;
                    let newEvidenceQuality = formData.evidence_quality;

                    // 規則 1: 如果承諾狀態是 No，證據狀態和品質都應該是 N/A
                    if (formData.promise_status === 'No') {
                      newEvidenceQuality = 'N/A';
                    }
                    // 規則 2: 如果證據狀態選 No，證據品質設為 N/A
                    else if (newEvidenceStatus === 'No') {
                      newEvidenceQuality = 'N/A';
                    }
                    // 規則 3: 如果證據狀態選 Yes 且品質是 N/A，則清空
                    else if (newEvidenceStatus === 'Yes' && formData.evidence_quality === 'N/A') {
                      newEvidenceQuality = '';
                    }

                    setFormData({
                      ...formData,
                      evidence_status: newEvidenceStatus,
                      evidence_quality: newEvidenceQuality
                    });
                  }}
                  disabled={formData.promise_status === 'No'}
                >
                  {formData.promise_status === 'No' ? (
                    <option value="N/A">N/A</option>
                  ) : (
                    <>
                      <option value="">請選擇</option>
                      <option value="Yes">Yes</option>
                      <option value="No">No</option>
                    </>
                  )}
                </select>
              </div>
            )}

            {taskData.tasksFlagged.evidence_quality !== undefined && (
              <div className="field">
                <label>
                  證據品質
                  <span className="score-badge">需重新檢視 (α={taskData.tasksFlagged.evidence_quality.toFixed(2)})</span>
                </label>
                <select
                  value={formData.evidence_quality}
                  onChange={(e) => setFormData({ ...formData, evidence_quality: e.target.value })}
                  disabled={formData.promise_status === 'No' || formData.evidence_status === 'No'}
                >
                  {(formData.promise_status === 'No' || formData.evidence_status === 'No') ? (
                    <option value="N/A">N/A</option>
                  ) : (
                    <>
                      <option value="">請選擇</option>
                      <option value="Clear">清晰</option>
                      <option value="Not Clear">不清晰</option>
                      <option value="Misleading">誤導性</option>
                      {formData.evidence_status !== 'Yes' && <option value="N/A">N/A</option>}
                    </>
                  )}
                </select>
              </div>
            )}

            {/* 堅持答案選項 */}
            <div className="checkbox-container-persist">
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
            <div className="field">
              <label>備註 (選填)</label>
              <textarea
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ddd',
                  borderRadius: '4px',
                  fontSize: '14px',
                  minHeight: '80px'
                }}
                placeholder="說明為何修改或堅持原答案..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
            </div>

            {/* 送出按鈕 */}
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button
                className="btn btn-emerald"
                onClick={handleSubmit}
                disabled={submitting}
                style={{ flex: 1 }}
              >
                {submitting ? '送出中...' : '✓ 送出重標註'}
              </button>
              <button
                className="btn"
                style={{ background: '#6b7280', color: 'white' }}
                onClick={() => router.push('/reannotation')}
                disabled={submitting}
              >
                取消
              </button>
            </div>
          </div>
        </div>

        {/* PDF 預覽 */}
        {taskData.sourceUrl && (
          <div className="panel">
            <h2>PDF 文件 (第 {taskData.pageNumber} 頁)</h2>
            <PDFViewer pdfUrl={taskData.sourceUrl} />
          </div>
        )}
      </div>
    </div>
  );
}
