// 檔案路徑: app/admin/agreement/page.js
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AgreementAnalysisPage() {
    const [user, setUser] = useState(null);
    const [projects, setProjects] = useState([]);
    const [selectedProject, setSelectedProject] = useState(null);
    const [agreementData, setAgreementData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState('summary'); // summary, details, cases
    const [showInconsistentOnly, setShowInconsistentOnly] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const router = useRouter();

    // Fixed light theme
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
        inconsistentBg: '#fef2f2',
        inconsistentBorder: '#ef4444'
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
                loadProjects(parsedUser.id);
            }
        } else {
            alert('請先登入');
            router.push('/');
        }
    }, [router]);

    const loadProjects = async (userId) => {
        // 使用專門的 API 來取得已完成標註的專案
        // 條件：至少有 2 位使用者完成該專案的所有標註
        try {
            const response = await fetch('/api/get-completed-projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId })
            });

            const result = await response.json();
            if (result.success) {
                setProjects(result.projects);
            } else {
                console.error('載入專案失敗:', result.error);
                setProjects([]);
            }
        } catch (error) {
            console.error('載入專案失敗:', error);
            setProjects([]);
        }
    };

    const handleCalculateAgreement = async () => {
        if (!selectedProject) {
            alert('請選擇專案');
            return;
        }

        setLoading(true);
        try {
            const response = await fetch('/api/calculate-agreement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user.id,
                    projectId: selectedProject
                })
            });

            const result = await response.json();

            if (result.success) {
                setAgreementData(result.data);
                setActiveTab('summary');
            } else {
                alert(`計算失敗: ${result.error}`);
            }
        } catch (error) {
            alert(`錯誤: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleExportCSV = () => {
        if (!agreementData) return;

        const projectName = agreementData.projectName;
        const timestamp = new Date().toISOString().split('T')[0];

        // 匯出 Global Summary
        const globalHeaders = ['Task', 'TaskName', 'Global_Alpha', 'Quality'];
        const globalRows = agreementData.globalResults.map(r => [
            r.task,
            r.taskName,
            r.alpha.toFixed(4),
            r.quality
        ]);

        const globalCSV = [
            globalHeaders.join(','),
            ...globalRows.map(row => row.join(','))
        ].join('\n');

        const globalBlob = new Blob(['\ufeff' + globalCSV], { type: 'text/csv;charset=utf-8;' });
        const globalLink = document.createElement('a');
        globalLink.href = URL.createObjectURL(globalBlob);
        globalLink.download = `${projectName}_Global_Summary_${timestamp}.csv`;
        globalLink.click();

        // 匯出 Detailed Rows
        const detailedHeaders = [
            'source_data_id',
            'original_data',
            'promise_status_score',
            'verification_timeline_score',
            'evidence_status_score',
            'evidence_quality_score',
            'has_inconsistency',
            ...agreementData.annotators.flatMap(ann => [
                `promise_status_${ann}`,
                `verification_timeline_${ann}`,
                `evidence_status_${ann}`,
                `evidence_quality_${ann}`
            ])
        ];

        const detailedRows = agreementData.detailedResults.map(item => {
            const row = [
                item.source_data_id,
                `"${(item.original_data || '').replace(/"/g, '""')}"`,
                item.promise_status_score.toFixed(3),
                item.verification_timeline_score.toFixed(3),
                item.evidence_status_score.toFixed(3),
                item.evidence_quality_score.toFixed(3),
                item.hasInconsistency ? '是' : '否'
            ];

            agreementData.annotators.forEach(ann => {
                const annotatorData = item.annotators.find(a => a.name === ann);
                if (annotatorData) {
                    row.push(
                        `"${annotatorData.promise_status || ''}"`,
                        `"${annotatorData.verification_timeline || ''}"`,
                        `"${annotatorData.evidence_status || ''}"`,
                        `"${annotatorData.evidence_quality || ''}"`
                    );
                } else {
                    row.push('', '', '', '');
                }
            });

            return row.join(',');
        });

        const detailedCSV = [
            detailedHeaders.join(','),
            ...detailedRows
        ].join('\n');

        const detailedBlob = new Blob(['\ufeff' + detailedCSV], { type: 'text/csv;charset=utf-8;' });
        const detailedLink = document.createElement('a');
        detailedLink.href = URL.createObjectURL(detailedBlob);
        detailedLink.download = `${projectName}_Detailed_Rows_${timestamp}.csv`;
        detailedLink.click();

        alert('已成功匯出 Global Summary 和 Detailed Rows 兩個檔案！');
    };

    const getFilteredDetails = () => {
        if (!agreementData) return [];

        let filtered = agreementData.detailedResults;

        if (showInconsistentOnly) {
            filtered = filtered.filter(item => item.hasInconsistency);
        }

        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(item =>
                item.original_data.toLowerCase().includes(query) ||
                item.source_data_id.toString().includes(query)
            );
        }

        return filtered;
    };

    if (!user) return <div className="container"><h1>驗證中...</h1></div>;

    return (
        <div className="container" style={{
            maxWidth: '1400px',
            margin: '0 auto',
            padding: '20px',
            background: theme.bg,
            minHeight: '100vh',
            transition: 'all 0.3s ease'
        }}>
            <style jsx>{`
                .container {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                }
                .header {
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
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
                    transition: all 0.3s ease;
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
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                }
                .btn-primary:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
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
                    transition: all 0.3s ease;
                }
                .stat-value {
                    font-size: 2.5rem;
                    font-weight: 700;
                    color: #667eea;
                    margin: 10px 0;
                }
                .stat-label {
                    font-size: 0.9rem;
                    color: ${theme.textSecondary};
                }
                .tabs {
                    display: flex;
                    gap: 10px;
                    border-bottom: 2px solid ${theme.border};
                    margin-bottom: 20px;
                }
                .tab {
                    padding: 12px 24px;
                    border: none;
                    background: none;
                    cursor: pointer;
                    font-size: 15px;
                    font-weight: 600;
                    color: ${theme.textSecondary};
                    border-bottom: 3px solid transparent;
                    transition: all 0.3s;
                }
                .tab.active {
                    color: #667eea;
                    border-bottom-color: #667eea;
                }
                .tab:hover {
                    color: #667eea;
                }
                .task-card {
                    background: ${theme.bgPanel};
                    border: 2px solid ${theme.border};
                    border-radius: 10px;
                    padding: 20px;
                    margin-bottom: 15px;
                    transition: all 0.3s;
                }
                .task-card:hover {
                    border-color: #667eea;
                    box-shadow: 0 4px 12px rgba(102, 126, 234, 0.1);
                }
                .alpha-high {
                    color: #10b981;
                    font-weight: 700;
                }
                .alpha-medium {
                    color: #f59e0b;
                    font-weight: 700;
                }
                .alpha-low {
                    color: #ef4444;
                    font-weight: 700;
                }
                .data-table {
                    width: 100%;
                    border-collapse: collapse;
                    font-size: 14px;
                }
                .data-table th {
                    background: ${theme.tableHeader};
                    padding: 12px;
                    text-align: left;
                    font-weight: 600;
                    color: ${theme.text};
                    border-bottom: 2px solid ${theme.border};
                }
                .data-table td {
                    padding: 12px;
                    border-bottom: 1px solid ${theme.border};
                    color: ${theme.text};
                }
                .data-table tr:hover {
                    background: ${theme.tableHover};
                }
                .data-table tr.inconsistent {
                    background: ${theme.inconsistentBg};
                    border-left: 4px solid ${theme.inconsistentBorder};
                }
                .badge {
                    display: inline-block;
                    padding: 4px 12px;
                    border-radius: 12px;
                    font-size: 12px;
                    font-weight: 600;
                }
                .badge-success {
                    background: #d1fae5;
                    color: #065f46;
                }
                .badge-warning {
                    background: #fed7aa;
                    color: #92400e;
                }
                .badge-danger {
                    background: #fee2e2;
                    color: #991b1b;
                }
                .filter-bar {
                    display: flex;
                    gap: 15px;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    align-items: center;
                }
                .filter-bar select,
                .filter-bar input {
                    padding: 10px 15px;
                    border: 1px solid ${theme.border};
                    border-radius: 8px;
                    font-size: 14px;
                    background: ${theme.bgPanel};
                    color: ${theme.text};
                    transition: all 0.3s ease;
                }
                .filter-bar input {
                    flex: 1;
                    min-width: 250px;
                }
                .filter-bar select:focus,
                .filter-bar input:focus {
                    outline: none;
                    border-color: #667eea;
                    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
                }
                .toggle-btn {
                    padding: 10px 15px;
                    background: ${theme.bgPanel};
                    color: ${theme.text};
                    border: 2px solid ${theme.border};
                    border-radius: 8px;
                    cursor: pointer;
                    transition: all 0.3s;
                }
                .toggle-btn.active {
                    background: #667eea;
                    color: white;
                    border-color: #667eea;
                }
                .toggle-btn:hover {
                    border-color: #667eea;
                }
                .annotator-tag {
                    display: inline-block;
                    padding: 4px 8px;
                    background: ${theme.borderLight};
                    border-radius: 6px;
                    font-size: 12px;
                    margin-right: 5px;
                    margin-bottom: 5px;
                    color: ${theme.text};
                }
            `}</style>

            <div className="header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ margin: '0 0 10px 0' }}>📊 標註一致性分析</h1>
                        <p style={{ margin: 0, opacity: 0.9 }}>Krippendorff's Alpha 計算與爭議案例檢視</p>
                    </div>
                    <button
                        className="btn btn-secondary"
                        onClick={() => router.push('/admin')}
                    >
                        ← 返回管理頁面
                    </button>
                </div>
            </div>

            {/* 專案選擇與計算 */}
            <div className="panel">
                <h2>選擇專案</h2>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center', marginTop: '20px' }}>
                    <select
                        value={selectedProject || ''}
                        onChange={(e) => setSelectedProject(e.target.value ? parseInt(e.target.value) : null)}
                        style={{
                            flex: 1,
                            padding: '12px',
                            border: `2px solid ${theme.border}`,
                            borderRadius: '8px',
                            fontSize: '14px',
                            background: theme.bgPanel,
                            color: theme.text
                        }}
                    >
                        <option value="">請選擇專案...</option>
                        {projects.map(p => (
                            <option key={p.id} value={p.id}>
                                {p.name} ({p.users_completed} 位使用者完成，共 {p.total_tasks} 題)
                            </option>
                        ))}
                    </select>
                    <button
                        className="btn btn-primary"
                        onClick={handleCalculateAgreement}
                        disabled={!selectedProject || loading}
                    >
                        {loading ? '計算中...' : '🔍 計算一致性'}
                    </button>
                    {agreementData && (
                        <button
                            className="btn btn-secondary"
                            onClick={handleExportCSV}
                        >
                            📥 匯出 CSV
                        </button>
                    )}
                </div>
            </div>

            {/* 結果顯示 */}
            {agreementData && (
                <>
                    {/* 統計摘要 */}
                    <div className="panel">
                        <h2 style={{ marginBottom: '20px' }}>統計摘要</h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                            <div className="stat-card">
                                <div className="stat-label">標註者數量</div>
                                <div className="stat-value">{agreementData.annotators.length}</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-label">總案例數</div>
                                <div className="stat-value">{agreementData.stats.totalCases}</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-label">平均 Alpha</div>
                                <div className="stat-value">{agreementData.stats.avgAlpha.toFixed(3)}</div>
                            </div>
                            <div className="stat-card">
                                <div className="stat-label">爭議案例</div>
                                <div className="stat-value" style={{ color: '#ef4444' }}>
                                    {agreementData.stats.inconsistentCases}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 分頁標籤 */}
                    <div className="tabs">
                        <button
                            className={`tab ${activeTab === 'summary' ? 'active' : ''}`}
                            onClick={() => setActiveTab('summary')}
                        >
                            📈 整體一致性
                        </button>
                        <button
                            className={`tab ${activeTab === 'details' ? 'active' : ''}`}
                            onClick={() => setActiveTab('details')}
                        >
                            📋 詳細清單
                        </button>
                        <button
                            className={`tab ${activeTab === 'cases' ? 'active' : ''}`}
                            onClick={() => setActiveTab('cases')}
                        >
                            ⚠️ 爭議案例
                        </button>
                    </div>

                    {/* 整體一致性分頁 */}
                    {activeTab === 'summary' && (
                        <div className="panel">
                            <h2 style={{ marginBottom: '20px' }}>各任務 Krippendorff's Alpha</h2>
                            <div style={{ display: 'grid', gap: '15px' }}>
                                {agreementData.globalResults.map(result => {
                                    const alphaClass = result.alpha >= 0.8 ? 'alpha-high' :
                                                      result.alpha >= 0.667 ? 'alpha-medium' : 'alpha-low';
                                    return (
                                        <div key={result.task} className="task-card">
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                <div>
                                                    <h3 style={{ margin: '0 0 5px 0' }}>{result.taskName}</h3>
                                                    <p style={{ margin: 0, color: '#6b7280', fontSize: '14px' }}>{result.task}</p>
                                                </div>
                                                <div style={{ textAlign: 'right' }}>
                                                    <div className={alphaClass} style={{ fontSize: '2rem' }}>
                                                        α = {result.alpha.toFixed(3)}
                                                    </div>
                                                    <span className={`badge ${result.quality === 'High' ? 'badge-success' :
                                                                              result.quality === 'Acceptable' ? 'badge-warning' : 'badge-danger'}`}>
                                                        {result.quality}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            <div style={{ marginTop: '30px', padding: '20px', background: theme.borderLight, borderRadius: '10px', border: `1px solid ${theme.border}` }}>
                                <h3 style={{ color: theme.text }}>標註者</h3>
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '10px' }}>
                                    {agreementData.annotators.map(ann => (
                                        <span key={ann} className="annotator-tag" style={{ padding: '8px 16px', fontSize: '14px' }}>
                                            👤 {ann}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* 詳細清單分頁 */}
                    {activeTab === 'details' && (
                        <div className="panel">
                            <div className="filter-bar">
                                <input
                                    type="text"
                                    placeholder="🔍 搜尋文本或 ID..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                                <button
                                    className={`toggle-btn ${showInconsistentOnly ? 'active' : ''}`}
                                    onClick={() => setShowInconsistentOnly(!showInconsistentOnly)}
                                >
                                    ⚠️ 只顯示爭議
                                </button>
                            </div>

                            <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th style={{ minWidth: '60px' }}>案例 ID</th>
                                            <th style={{ minWidth: '300px' }}>永續承諾文本</th>
                                            <th style={{ minWidth: '180px' }}>承諾狀態</th>
                                            <th style={{ minWidth: '180px' }}>驗證時間</th>
                                            <th style={{ minWidth: '180px' }}>證據狀態</th>
                                            <th style={{ minWidth: '180px' }}>證據品質</th>
                                            <th style={{ minWidth: '80px' }}>一致性</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {getFilteredDetails().map(item => (
                                            <tr key={item.source_data_id} className={item.hasInconsistency ? 'inconsistent' : ''}>
                                                <td style={{ fontWeight: 'bold', fontSize: '13px' }}>{item.source_data_id}</td>
                                                <td style={{ maxWidth: '350px', lineHeight: '1.6' }}>
                                                    {item.original_data}
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                                            <span className={item.promise_status_score >= 0.5 ? 'alpha-high' : 'alpha-low'}>
                                                                {item.promise_status_score.toFixed(2)}
                                                            </span>
                                                        </div>
                                                        {item.annotators.map(ann => (
                                                            <div key={ann.name} className="annotator-tag" style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '8px' }}>{ann.name}</span>
                                                                <span style={{ fontWeight: '500' }}>{ann.promise_status || '-'}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                                            <span className={item.verification_timeline_score >= 0.5 ? 'alpha-high' : 'alpha-low'}>
                                                                {item.verification_timeline_score.toFixed(2)}
                                                            </span>
                                                        </div>
                                                        {item.annotators.map(ann => (
                                                            <div key={ann.name} className="annotator-tag" style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '8px' }}>{ann.name}</span>
                                                                <span style={{ fontWeight: '500' }}>{ann.verification_timeline || '-'}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                                            <span className={item.evidence_status_score >= 0.5 ? 'alpha-high' : 'alpha-low'}>
                                                                {item.evidence_status_score.toFixed(2)}
                                                            </span>
                                                        </div>
                                                        {item.annotators.map(ann => (
                                                            <div key={ann.name} className="annotator-tag" style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '8px' }}>{ann.name}</span>
                                                                <span style={{ fontWeight: '500' }}>{ann.evidence_status || '-'}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                        <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
                                                            <span className={item.evidence_quality_score >= 0.5 ? 'alpha-high' : 'alpha-low'}>
                                                                {item.evidence_quality_score.toFixed(2)}
                                                            </span>
                                                        </div>
                                                        {item.annotators.map(ann => (
                                                            <div key={ann.name} className="annotator-tag" style={{ fontSize: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '8px' }}>{ann.name}</span>
                                                                <span style={{ fontWeight: '500' }}>{ann.evidence_quality || '-'}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    {item.hasInconsistency ? (
                                                        <span className="badge badge-danger">⚠️ 爭議</span>
                                                    ) : (
                                                        <span className="badge badge-success">✓ 一致</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <p style={{ marginTop: '15px', color: '#6b7280', fontSize: '14px' }}>
                                顯示 {getFilteredDetails().length} / {agreementData.detailedResults.length} 筆資料
                            </p>
                        </div>
                    )}

                    {/* 爭議案例分頁 */}
                    {activeTab === 'cases' && (
                        <div className="panel">
                            <h2 style={{ marginBottom: '20px' }}>爭議案例詳細檢視</h2>
                            {agreementData.detailedResults
                                .filter(item => item.hasInconsistency)
                                .slice(0, 10)
                                .map(item => (
                                    <div key={item.source_data_id} style={{
                                        background: theme.inconsistentBg,
                                        border: `2px solid ${theme.inconsistentBorder}`,
                                        borderRadius: '10px',
                                        padding: '20px',
                                        marginBottom: '20px'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '15px' }}>
                                            <h3 style={{ margin: 0 }}>案例 #{item.source_data_id}</h3>
                                            <span className="badge badge-danger">⚠️ 存在爭議</span>
                                        </div>

                                        <div style={{
                                            background: theme.bgPanel,
                                            padding: '15px',
                                            borderRadius: '8px',
                                            marginBottom: '15px',
                                            borderLeft: '4px solid #ef4444'
                                        }}>
                                            <p style={{ margin: 0, lineHeight: '1.6', color: theme.text }}>{item.original_data}</p>
                                        </div>

                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(4, 1fr)',
                                            gap: '10px',
                                            marginBottom: '15px'
                                        }}>
                                            <div style={{ background: theme.bgPanel, padding: '10px', borderRadius: '6px', textAlign: 'center', border: `1px solid ${theme.border}` }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary }}>承諾狀態</div>
                                                <div className={item.promise_status_score >= 0.5 ? 'alpha-high' : 'alpha-low'} style={{ fontSize: '1.2rem' }}>
                                                    {item.promise_status_score.toFixed(2)}
                                                </div>
                                            </div>
                                            <div style={{ background: theme.bgPanel, padding: '10px', borderRadius: '6px', textAlign: 'center', border: `1px solid ${theme.border}` }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary }}>驗證時間</div>
                                                <div className={item.verification_timeline_score >= 0.5 ? 'alpha-high' : 'alpha-low'} style={{ fontSize: '1.2rem' }}>
                                                    {item.verification_timeline_score.toFixed(2)}
                                                </div>
                                            </div>
                                            <div style={{ background: theme.bgPanel, padding: '10px', borderRadius: '6px', textAlign: 'center', border: `1px solid ${theme.border}` }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary }}>證據狀態</div>
                                                <div className={item.evidence_status_score >= 0.5 ? 'alpha-high' : 'alpha-low'} style={{ fontSize: '1.2rem' }}>
                                                    {item.evidence_status_score.toFixed(2)}
                                                </div>
                                            </div>
                                            <div style={{ background: theme.bgPanel, padding: '10px', borderRadius: '6px', textAlign: 'center', border: `1px solid ${theme.border}` }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary }}>證據品質</div>
                                                <div className={item.evidence_quality_score >= 0.5 ? 'alpha-high' : 'alpha-low'} style={{ fontSize: '1.2rem' }}>
                                                    {item.evidence_quality_score.toFixed(2)}
                                                </div>
                                            </div>
                                        </div>

                                        <h4 style={{ marginBottom: '10px', color: theme.text }}>標註者比較</h4>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px' }}>
                                            {item.annotators.map(ann => (
                                                <div key={ann.name} style={{
                                                    background: theme.bgPanel,
                                                    padding: '12px',
                                                    borderRadius: '8px',
                                                    border: `1px solid ${theme.border}`
                                                }}>
                                                    <div style={{ fontWeight: 'bold', marginBottom: '8px', color: theme.text }}>👤 {ann.name}</div>
                                                    <div style={{ fontSize: '13px', lineHeight: '1.8', color: theme.text }}>
                                                        <div><strong>承諾:</strong> {ann.promise_status || '-'}</div>
                                                        <div><strong>時間:</strong> {ann.verification_timeline || '-'}</div>
                                                        <div><strong>證據:</strong> {ann.evidence_status || '-'}</div>
                                                        <div><strong>品質:</strong> {ann.evidence_quality || '-'}</div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                        </div>
                    )}
                </>
            )}

            {!agreementData && !loading && (
                <div className="panel" style={{ textAlign: 'center', padding: '60px', color: theme.textSecondary }}>
                    <div style={{ fontSize: '4rem', marginBottom: '20px' }}>📊</div>
                    <h3 style={{ color: theme.text }}>請選擇專案並開始計算一致性</h3>
                    <p>系統將自動計算 Krippendorff's Alpha 並找出爭議案例</p>
                </div>
            )}
        </div>
    );
}
