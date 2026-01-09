// 檔案路徑: app/admin/consistency-dashboard/page.js
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

export default function ConsistencyDashboard() {
    const [user, setUser] = useState(null);
    const [allData, setAllData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const router = useRouter();

    // 篩選狀態
    const [filters, setFilters] = useState({
        group: 'all',
        roundType: 'all', // all, initial, reannotation
        week: 'all',
        persistAnswer: 'all' // all, yes, no
    });

    // 統計資料
    const [stats, setStats] = useState({
        totalProjects: 0,
        totalReannotations: 0,
        newAnalysis: 0,
        fromCache: 0
    });

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
        primary: '#667eea',
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444'
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
                // 自動載入快取的分析結果
                loadCachedResults(parsedUser.id);
            }
        } else {
            alert('請先登入');
            router.push('/');
        }
    }, [router]);

    // 載入快取的分析結果
    const loadCachedResults = async (userId) => {
        setLoading(true);
        try {
            const response = await fetch('/api/batch-calculate-agreement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, force: false })
            });

            const result = await response.json();

            if (result.success && result.data.results.length > 0) {
                setAllData(result.data.results);
                setStats(result.data.summary);
            }
        } catch (error) {
            console.error('載入快取失敗:', error);
        } finally {
            setLoading(false);
        }
    };

    // 執行批次分析
    const handleBatchAnalysis = async (force = false) => {
        if (!user) return;

        setAnalyzing(true);
        try {
            const response = await fetch('/api/batch-calculate-agreement', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: user.id, force })
            });

            const result = await response.json();

            if (result.success) {
                setAllData(result.data.results);
                setStats(result.data.summary);
                alert(`分析完成！\n新分析: ${result.data.summary.newAnalysis} 個\n使用快取: ${result.data.summary.fromCache} 個`);
            } else {
                alert(`分析失敗: ${result.error}`);
            }
        } catch (error) {
            alert(`錯誤: ${error.message}`);
        } finally {
            setAnalyzing(false);
        }
    };

    // 取得篩選後的資料
    const getFilteredData = () => {
        return allData.filter(item => {
            if (filters.group !== 'all' && item.groupName !== filters.group) return false;
            if (filters.roundType !== 'all') {
                if (filters.roundType === 'initial' && item.roundType !== 'initial') return false;
                if (filters.roundType === 'reannotation' && item.roundType !== 'reannotation') return false;
            }
            if (filters.week !== 'all' && item.week !== parseInt(filters.week)) return false;

            // 篩選「堅持答案」- 只在重標註資料中篩選
            if (filters.persistAnswer !== 'all' && item.roundType === 'reannotation') {
                const hasPersistAnswer = item.detailedResults?.some(detail =>
                    detail.annotators?.some(ann => ann.persist_answer === true)
                );

                if (filters.persistAnswer === 'yes' && !hasPersistAnswer) return false;
                if (filters.persistAnswer === 'no' && hasPersistAnswer) return false;
            }

            return true;
        });
    };

    // 取得所有組別
    const getAllGroups = () => {
        const groups = [...new Set(allData.map(item => item.groupName).filter(Boolean))];
        return groups.sort();
    };

    // 取得所有週數
    const getAllWeeks = () => {
        const weeks = [...new Set(allData.map(item => item.week))];
        return weeks.sort((a, b) => a - b);
    };

    // 匯出到 Excel（按組別分 sheet）
    const handleExportExcel = () => {
        if (allData.length === 0) {
            alert('沒有資料可匯出');
            return;
        }

        const wb = XLSX.utils.book_new();
        const groups = getAllGroups();

        if (groups.length === 0) {
            // 沒有組別，全部資料放在一個 sheet
            const sheetData = prepareExportData(allData);
            const ws = XLSX.utils.json_to_sheet(sheetData);
            XLSX.utils.book_append_sheet(wb, ws, '全部資料');
        } else {
            // 按組別分 sheet
            groups.forEach(groupName => {
                const groupData = allData.filter(item => item.groupName === groupName);
                const sheetData = prepareExportData(groupData);
                const ws = XLSX.utils.json_to_sheet(sheetData);

                // Sheet 名稱限制 31 字元
                const sheetName = groupName.length > 31 ? groupName.substring(0, 31) : groupName;
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });

            // 新增統計摘要 sheet
            const summaryData = prepareSummaryData();
            const summaryWs = XLSX.utils.json_to_sheet(summaryData);
            XLSX.utils.book_append_sheet(wb, summaryWs, '統計摘要');
        }

        // 下載檔案
        const timestamp = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `標註一致性分析_${timestamp}.xlsx`);
        alert('Excel 檔案已匯出！');
    };

    // 準備匯出資料（詳細標註資料）
    const prepareExportData = (data) => {
        const exportData = [];

        data.forEach(item => {
            if (!item.detailedResults) {
                // 從快取讀取的資料，需要轉換格式
                const scoresBySource = {};
                if (item.scores) {
                    item.scores.forEach(score => {
                        if (!scoresBySource[score.source_data_id]) {
                            scoresBySource[score.source_data_id] = {
                                source_data_id: score.source_data_id,
                                scores: {}
                            };
                        }
                        scoresBySource[score.source_data_id].scores[score.task_name] = score.local_score;
                    });
                }

                Object.values(scoresBySource).forEach(sourceData => {
                    exportData.push({
                        '組別': item.groupName || '未分組',
                        '專案名稱': item.projectName,
                        '週數': `第${item.week}週`,
                        '標註類型': item.roundType === 'initial' ? '初次標註' : `重標註第${item.roundNumber}輪`,
                        '任務組別': item.taskGroup || '全部',
                        '資料ID': sourceData.source_data_id,
                        '承諾狀態分數': sourceData.scores.promise_status != null ? Number(sourceData.scores.promise_status).toFixed(3) : 'N/A',
                        '驗證時間分數': sourceData.scores.verification_timeline != null ? Number(sourceData.scores.verification_timeline).toFixed(3) : 'N/A',
                        '證據狀態分數': sourceData.scores.evidence_status != null ? Number(sourceData.scores.evidence_status).toFixed(3) : 'N/A',
                        '證據品質分數': sourceData.scores.evidence_quality != null ? Number(sourceData.scores.evidence_quality).toFixed(3) : 'N/A',
                        '計算時間': item.calculatedAt ? new Date(item.calculatedAt).toLocaleString('zh-TW') : ''
                    });
                });
            } else {
                // 新計算的資料
                item.detailedResults.forEach(detail => {
                    const row = {
                        '組別': item.groupName || '未分組',
                        '專案名稱': item.projectName,
                        '週數': `第${item.week}週`,
                        '標註類型': item.roundType === 'initial' ? '初次標註' : `重標註第${item.roundNumber}輪`,
                        '任務組別': item.taskGroup || '全部',
                        '資料ID': detail.source_data_id,
                        '原始文本': detail.original_data,
                        '承諾狀態分數': detail.scores.promise_status != null ? Number(detail.scores.promise_status).toFixed(3) : 'N/A',
                        '驗證時間分數': detail.scores.verification_timeline != null ? Number(detail.scores.verification_timeline).toFixed(3) : 'N/A',
                        '證據狀態分數': detail.scores.evidence_status != null ? Number(detail.scores.evidence_status).toFixed(3) : 'N/A',
                        '證據品質分數': detail.scores.evidence_quality != null ? Number(detail.scores.evidence_quality).toFixed(3) : 'N/A'
                    };

                    // 加入各標註者的答案
                    if (detail.annotators) {
                        detail.annotators.forEach((ann, idx) => {
                            row[`標註者${idx + 1}`] = ann.username || ann.user_id;
                            row[`標註者${idx + 1}_承諾狀態`] = ann.promise_status || '';
                            row[`標註者${idx + 1}_驗證時間`] = ann.verification_timeline || '';
                            row[`標註者${idx + 1}_證據狀態`] = ann.evidence_status || '';
                            row[`標註者${idx + 1}_證據品質`] = ann.evidence_quality || '';
                        });
                    }

                    row['計算時間'] = item.calculatedAt ? new Date(item.calculatedAt).toLocaleString('zh-TW') : '';

                    exportData.push(row);
                });
            }
        });

        return exportData;
    };

    // 準備統計摘要資料
    const prepareSummaryData = () => {
        const groups = getAllGroups();
        const summaryData = [];

        groups.forEach(groupName => {
            const groupData = allData.filter(item => item.groupName === groupName);
            const initialData = groupData.filter(item => item.roundType === 'initial');
            const reannotationData = groupData.filter(item => item.roundType === 'reannotation');

            summaryData.push({
                '組別': groupName,
                '初次標註專案數': initialData.length,
                '重標註輪次數': reannotationData.length,
                '總資料筆數': groupData.reduce((sum, item) => {
                    if (item.detailedResults) return sum + item.detailedResults.length;
                    if (item.scores) return sum + [...new Set(item.scores.map(s => s.source_data_id))].length;
                    return sum;
                }, 0),
                '最後更新時間': groupData.length > 0
                    ? new Date(Math.max(...groupData.map(item => new Date(item.calculatedAt || 0)))).toLocaleString('zh-TW')
                    : ''
            });
        });

        return summaryData;
    };

    // 計算全域平均分數
    const calculateGlobalAverage = (data) => {
        const tasks = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'];
        const averages = {};

        tasks.forEach(task => {
            const scores = [];
            data.forEach(item => {
                if (item.detailedResults) {
                    item.detailedResults.forEach(detail => {
                        if (detail.scores[task] !== null && detail.scores[task] !== undefined) {
                            scores.push(Number(detail.scores[task]));
                        }
                    });
                } else if (item.scores) {
                    item.scores.forEach(score => {
                        if (score.task_name === task && score.local_score !== null && score.local_score !== undefined) {
                            scores.push(Number(score.local_score));
                        }
                    });
                }
            });

            averages[task] = scores.length > 0
                ? scores.reduce((a, b) => a + b, 0) / scores.length
                : null;
        });

        return averages;
    };

    const filteredData = getFilteredData();
    const globalAverages = calculateGlobalAverage(filteredData);

    // 展開狀態和分頁
    const [expandedRows, setExpandedRows] = useState({});
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 5;

    const toggleRow = (id) => {
        setExpandedRows(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    // 取得詳細資料清單（扁平化，每筆資料獨立）
    const getDetailedList = () => {
        const detailsList = [];

        filteredData.forEach(item => {
            if (item.detailedResults) {
                item.detailedResults.forEach(detail => {
                    detailsList.push({
                        ...detail,
                        groupName: item.groupName,
                        projectName: item.projectName,
                        week: item.week,
                        roundType: item.roundType,
                        roundNumber: item.roundNumber,
                        taskGroup: item.taskGroup
                    });
                });
            } else if (item.scores) {
                // 從 scores 重組資料
                const scoresBySource = {};
                item.scores.forEach(score => {
                    if (!scoresBySource[score.source_data_id]) {
                        scoresBySource[score.source_data_id] = {
                            source_data_id: score.source_data_id,
                            scores: {},
                            annotators: [],
                            groupName: item.groupName,
                            projectName: item.projectName,
                            week: item.week,
                            roundType: item.roundType,
                            roundNumber: item.roundNumber,
                            taskGroup: item.taskGroup
                        };
                    }
                    scoresBySource[score.source_data_id].scores[score.task_name] = score.local_score;
                });
                detailsList.push(...Object.values(scoresBySource));
            }
        });

        return detailsList;
    };

    // 計算平均分數
    const calculateAvgScore = (scores) => {
        const scoreValues = Object.values(scores).filter(s => s !== null && s !== undefined).map(s => Number(s));
        return scoreValues.length > 0
            ? scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length
            : null;
    };

    if (!user) return <div className="container"><h1>驗證中...</h1></div>;

    if (loading) {
        return (
            <div className="container" style={{
                maxWidth: '1600px',
                margin: '0 auto',
                padding: '20px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                minHeight: '100vh'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '3rem', marginBottom: '20px' }}>⏳</div>
                    <h2>載入分析結果中...</h2>
                </div>
            </div>
        );
    }

    return (
        <div className="container" style={{
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
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    padding: 30px;
                    border-radius: 12px;
                    margin-bottom: 30px;
                }
                .panel {
                    background: ${theme.bgPanel};
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
                    margin-right: 10px;
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
                .btn-success {
                    background: #10b981;
                    color: white;
                }
                .btn-success:hover {
                    background: #059669;
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
                    color: ${theme.primary};
                    margin: 10px 0;
                }
                .stat-label {
                    font-size: 0.9rem;
                    color: ${theme.textSecondary};
                }
                .filter-bar {
                    display: flex;
                    gap: 15px;
                    margin-bottom: 20px;
                    flex-wrap: wrap;
                    align-items: center;
                }
                .filter-bar select {
                    padding: 10px 15px;
                    border: 1px solid ${theme.border};
                    border-radius: 8px;
                    font-size: 14px;
                    background: ${theme.bgPanel};
                    color: ${theme.text};
                    min-width: 150px;
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
                    border-bottom: 2px solid ${theme.border};
                    position: sticky;
                    top: 0;
                }
                .data-table td {
                    padding: 12px;
                    border-bottom: 1px solid ${theme.border};
                }
                .data-table tr:hover {
                    background: ${theme.tableHover};
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
                .badge-info {
                    background: #dbeafe;
                    color: #1e40af;
                }
                .score-badge {
                    font-weight: 700;
                    padding: 4px 8px;
                    border-radius: 6px;
                }
                .score-high {
                    color: ${theme.success};
                    background: #d1fae5;
                }
                .score-medium {
                    color: ${theme.warning};
                    background: #fed7aa;
                }
                .score-low {
                    color: ${theme.danger};
                    background: #fee2e2;
                }
            `}</style>

            {/* 頁面標題 */}
            <div className="header">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ margin: '0 0 10px 0' }}>📊 標註一致性分析儀表板</h1>
                        <p style={{ margin: 0, opacity: 0.9 }}>智能批次分析 - 自動識別新專案和重標註資料</p>
                    </div>
                    <button className="btn btn-secondary" onClick={() => router.push('/admin')}>
                        ← 返回管理頁面
                    </button>
                </div>
            </div>

            {/* 資料篩選 */}
            {allData.length > 0 && (
                <div className="panel">
                    <h2 style={{ marginBottom: '20px' }}>資料篩選</h2>
                    <div className="filter-bar">
                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 600, fontSize: '13px' }}>組別</label>
                            <select
                                value={filters.group}
                                onChange={(e) => setFilters({ ...filters, group: e.target.value })}
                            >
                                <option value="all">全部組別</option>
                                {getAllGroups().map(group => (
                                    <option key={group} value={group}>{group}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 600, fontSize: '13px' }}>標註類型</label>
                            <select
                                value={filters.roundType}
                                onChange={(e) => setFilters({ ...filters, roundType: e.target.value })}
                            >
                                <option value="all">全部類型</option>
                                <option value="initial">初次標註</option>
                                <option value="reannotation">重標註</option>
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 600, fontSize: '13px' }}>週次</label>
                            <select
                                value={filters.week}
                                onChange={(e) => setFilters({ ...filters, week: e.target.value })}
                            >
                                <option value="all">全部週次</option>
                                {getAllWeeks().map(week => (
                                    <option key={week} value={week}>第 {week} 週</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 600, fontSize: '13px' }}>堅持答案 (重標註)</label>
                            <select
                                value={filters.persistAnswer}
                                onChange={(e) => setFilters({ ...filters, persistAnswer: e.target.value })}
                            >
                                <option value="all">全部資料</option>
                                <option value="yes">✓ 有堅持答案</option>
                                <option value="no">無堅持答案</option>
                            </select>
                        </div>
                    </div>
                    <p style={{ marginTop: '15px', color: theme.textSecondary, fontSize: '14px' }}>
                        顯示 {filteredData.length} / {allData.length} 筆資料
                    </p>
                </div>
            )}

            {/* 控制面板 */}
            <div className="panel">
                <h2 style={{ marginBottom: '20px' }}>批次分析控制</h2>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                        className="btn btn-primary"
                        onClick={() => handleBatchAnalysis(false)}
                        disabled={analyzing}
                    >
                        {analyzing ? '⏳ 分析中...' : '🚀 執行智能分析（僅新資料）'}
                    </button>
                    <button
                        className="btn btn-secondary"
                        onClick={() => handleBatchAnalysis(true)}
                        disabled={analyzing}
                    >
                        🔄 重新分析全部
                    </button>
                    <button
                        className="btn btn-success"
                        onClick={handleExportExcel}
                        disabled={allData.length === 0}
                    >
                        📥 匯出完整 Excel
                    </button>
                </div>
                {analyzing && (
                    <div style={{ marginTop: '15px', padding: '15px', background: '#f0f9ff', borderRadius: '8px', border: '1px solid #0ea5e9' }}>
                        <p style={{ margin: 0, color: '#0369a1', fontWeight: 600 }}>
                            ⏳ 正在分析所有專案和重標註資料，請稍候...
                        </p>
                    </div>
                )}
            </div>

            {/* 統計摘要 */}
            {allData.length > 0 && (
                <div className="panel">
                    <h2 style={{ marginBottom: '20px' }}>統計摘要</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                        <div className="stat-card">
                            <div className="stat-label">初次標註專案</div>
                            <div className="stat-value">{stats.totalProjects}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">重標註輪次</div>
                            <div className="stat-value">{stats.totalReannotations}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">新分析數量</div>
                            <div className="stat-value" style={{ color: theme.success }}>{stats.newAnalysis}</div>
                        </div>
                        <div className="stat-card">
                            <div className="stat-label">使用快取</div>
                            <div className="stat-value" style={{ color: theme.warning }}>{stats.fromCache}</div>
                        </div>
                    </div>
                </div>
            )}

            {/* 全域平均分數 */}
            {filteredData.length > 0 && (
                <div className="panel">
                    <h2 style={{ marginBottom: '20px' }}>整體一致性（篩選範圍）</h2>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '15px' }}>
                        {[
                            { key: 'promise_status', label: '承諾狀態' },
                            { key: 'verification_timeline', label: '驗證時間' },
                            { key: 'evidence_status', label: '證據狀態' },
                            { key: 'evidence_quality', label: '證據品質' }
                        ].map(task => {
                            const score = globalAverages[task.key];
                            const scoreClass = score >= 0.8 ? 'score-high' : score >= 0.5 ? 'score-medium' : 'score-low';
                            return (
                                <div key={task.key} style={{
                                    background: theme.borderLight,
                                    padding: '15px',
                                    borderRadius: '10px',
                                    border: `1px solid ${theme.border}`
                                }}>
                                    <div style={{ fontSize: '14px', color: theme.textSecondary, marginBottom: '8px' }}>
                                        {task.label}
                                    </div>
                                    <div className={`score-badge ${scoreClass}`} style={{ fontSize: '1.5rem' }}>
                                        {score !== null ? score.toFixed(3) : 'N/A'}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* 資料列表 */}
            {filteredData.length > 0 && (
                <div className="panel">
                    <h2 style={{ marginBottom: '20px' }}>分析結果列表</h2>
                    <div style={{ overflowX: 'auto', maxHeight: '600px', overflowY: 'auto' }}>
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>組別</th>
                                    <th>專案名稱</th>
                                    <th>週次</th>
                                    <th>類型</th>
                                    <th>輪次</th>
                                    <th>任務組</th>
                                    <th>資料筆數</th>
                                    <th>來源</th>
                                    <th>計算時間</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredData.map((item, idx) => {
                                    const dataCount = item.detailedResults
                                        ? item.detailedResults.length
                                        : (item.scores ? [...new Set(item.scores.map(s => s.source_data_id))].length : 0);

                                    return (
                                        <tr key={idx}>
                                            <td>{item.groupName || '未分組'}</td>
                                            <td style={{ maxWidth: '300px' }}>{item.projectName}</td>
                                            <td>
                                                <span className="badge badge-info">第 {item.week} 週</span>
                                            </td>
                                            <td>
                                                {item.roundType === 'initial' ? (
                                                    <span className="badge badge-success">初次標註</span>
                                                ) : (
                                                    <span className="badge badge-warning">重標註</span>
                                                )}
                                            </td>
                                            <td>{item.roundNumber === 0 ? '-' : `第 ${item.roundNumber} 輪`}</td>
                                            <td>{item.taskGroup || '全部'}</td>
                                            <td style={{ textAlign: 'center', fontWeight: 600 }}>{dataCount}</td>
                                            <td>
                                                {item.fromCache ? (
                                                    <span className="badge badge-warning">快取</span>
                                                ) : (
                                                    <span className="badge badge-success">新計算</span>
                                                )}
                                            </td>
                                            <td style={{ fontSize: '12px', color: theme.textSecondary }}>
                                                {item.calculatedAt ? new Date(item.calculatedAt).toLocaleString('zh-TW') : '-'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* 空狀態 */}
            {allData.length === 0 && !analyzing && (
                <div className="panel" style={{ textAlign: 'center', padding: '60px' }}>
                    <div style={{ fontSize: '4rem', marginBottom: '20px' }}>📊</div>
                    <h3>尚未執行分析</h3>
                    <p style={{ color: theme.textSecondary }}>
                        點擊「執行智能分析」按鈕開始批次分析所有專案的標註一致性
                    </p>
                    <p style={{ color: theme.textSecondary, fontSize: '14px', marginTop: '10px' }}>
                        智能分析會自動識別尚未分析的新專案和重標註資料，已分析過的資料會使用快取
                    </p>
                </div>
            )}

            {/* 詳細標註資料清單 */}
            {filteredData.length > 0 && (() => {
                const allDetails = getDetailedList();
                const totalItems = allDetails.length;
                const totalPages = Math.ceil(totalItems / itemsPerPage);
                const startIndex = (currentPage - 1) * itemsPerPage;
                const endIndex = startIndex + itemsPerPage;
                const currentItems = allDetails.slice(startIndex, endIndex);

                return (
                    <div className="panel">
                        <h2 style={{ marginBottom: '20px' }}>📋 詳細標註資料清單</h2>
                        <p style={{ marginBottom: '20px', color: theme.textSecondary }}>
                            點擊案例可展開查看詳細資訊 - 共 {totalItems} 筆資料
                        </p>

                        {currentItems.map((detail, idx) => {
                            const caseNumber = startIndex + idx + 1;
                            const detailId = `case_${caseNumber}`;
                            const isExpanded = expandedRows[detailId];
                            const scores = detail.scores || {};
                            const avgScore = calculateAvgScore(scores);

                            return (
                                <div key={detailId} style={{
                                    background: theme.bgPanel,
                                    border: `1px solid ${theme.border}`,
                                    borderRadius: '12px',
                                    marginBottom: '20px',
                                    overflow: 'hidden'
                                }}>
                                    {/* 標題區 */}
                                    <div
                                        style={{
                                            padding: '20px',
                                            cursor: 'pointer',
                                            background: isExpanded ? theme.borderLight : 'transparent'
                                        }}
                                        onClick={() => toggleRow(detailId)}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                                                案例 #{caseNumber}
                                            </h3>
                                            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                                                {(() => {
                                                    // 檢查是否有人堅持答案
                                                    const hasPersistAnswer = detail.annotators?.some(ann => ann.persist_answer === true);

                                                    return hasPersistAnswer ? (
                                                        <button style={{
                                                            background: '#fef3c7',
                                                            color: '#92400e',
                                                            border: '2px solid #f59e0b',
                                                            padding: '6px 12px',
                                                            borderRadius: '6px',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            cursor: 'pointer'
                                                        }}>
                                                            ✋ 有堅持答案
                                                        </button>
                                                    ) : null;
                                                })()}
                                                {(() => {
                                                    // Check if there's actual disagreement among annotators
                                                    if (!detail.annotators || detail.annotators.length <= 1) {
                                                        return null; // No dispute if 0 or 1 annotator
                                                    }

                                                    const hasDisagreement = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'].some(task => {
                                                        const values = detail.annotators
                                                            .map(ann => ann[task])
                                                            .filter(v => v !== null && v !== undefined && v !== 'N/A');

                                                        if (values.length <= 1) return false;

                                                        // Check if all values are the same
                                                        const firstValue = values[0];
                                                        return !values.every(v => v === firstValue);
                                                    });

                                                    return hasDisagreement ? (
                                                        <button style={{
                                                            background: theme.warning,
                                                            color: 'white',
                                                            border: 'none',
                                                            padding: '6px 12px',
                                                            borderRadius: '6px',
                                                            fontSize: '12px',
                                                            fontWeight: 600,
                                                            cursor: 'pointer'
                                                        }}>
                                                            ⚠️ 存在爭議
                                                        </button>
                                                    ) : null;
                                                })()}
                                            </div>
                                        </div>

                                        {/* 原始文本 */}
                                        {detail.original_data && (
                                            <div style={{
                                                background: '#f8f9fa',
                                                padding: '15px',
                                                borderRadius: '8px',
                                                marginBottom: '15px',
                                                borderLeft: `4px solid ${theme.primary}`
                                            }}>
                                                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.6', color: theme.text }}>
                                                    {detail.original_data}
                                                </p>
                                            </div>
                                        )}

                                        {/* 分數卡片 */}
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '15px', marginBottom: '15px' }}>
                                            <div style={{
                                                background: theme.borderLight,
                                                padding: '15px',
                                                borderRadius: '8px',
                                                textAlign: 'center'
                                            }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '8px' }}>
                                                    承諾狀態
                                                </div>
                                                <div style={{
                                                    fontSize: '24px',
                                                    fontWeight: 'bold',
                                                    color: scores.promise_status >= 0.8 ? theme.success : scores.promise_status >= 0.5 ? theme.warning : theme.danger
                                                }}>
                                                    {scores.promise_status != null ? Number(scores.promise_status).toFixed(2) : 'N/A'}
                                                </div>
                                            </div>
                                            <div style={{
                                                background: theme.borderLight,
                                                padding: '15px',
                                                borderRadius: '8px',
                                                textAlign: 'center'
                                            }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '8px' }}>
                                                    驗證時間
                                                </div>
                                                <div style={{
                                                    fontSize: '24px',
                                                    fontWeight: 'bold',
                                                    color: scores.verification_timeline >= 0.8 ? theme.success : scores.verification_timeline >= 0.5 ? theme.warning : theme.danger
                                                }}>
                                                    {scores.verification_timeline != null ? Number(scores.verification_timeline).toFixed(2) : 'N/A'}
                                                </div>
                                            </div>
                                            <div style={{
                                                background: theme.borderLight,
                                                padding: '15px',
                                                borderRadius: '8px',
                                                textAlign: 'center'
                                            }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '8px' }}>
                                                    證據狀態
                                                </div>
                                                <div style={{
                                                    fontSize: '24px',
                                                    fontWeight: 'bold',
                                                    color: scores.evidence_status >= 0.8 ? theme.success : scores.evidence_status >= 0.5 ? theme.warning : theme.danger
                                                }}>
                                                    {scores.evidence_status != null ? Number(scores.evidence_status).toFixed(2) : 'N/A'}
                                                </div>
                                            </div>
                                            <div style={{
                                                background: theme.borderLight,
                                                padding: '15px',
                                                borderRadius: '8px',
                                                textAlign: 'center'
                                            }}>
                                                <div style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '8px' }}>
                                                    證據品質
                                                </div>
                                                <div style={{
                                                    fontSize: '24px',
                                                    fontWeight: 'bold',
                                                    color: scores.evidence_quality >= 0.8 ? theme.success : scores.evidence_quality >= 0.5 ? theme.warning : theme.danger
                                                }}>
                                                    {scores.evidence_quality != null ? Number(scores.evidence_quality).toFixed(2) : 'N/A'}
                                                </div>
                                            </div>
                                        </div>

                                        {/* 展開按鈕提示 */}
                                        <div style={{ textAlign: 'center', color: theme.textSecondary, fontSize: '13px' }}>
                                            {isExpanded ? '▲ 點擊收合' : '▼ 點擊展開查看標註者比較'}
                                        </div>
                                    </div>

                                    {/* 展開內容：標註者比較 */}
                                    {isExpanded && detail.annotators && detail.annotators.length > 0 && (
                                        <div style={{ padding: '20px', background: theme.borderLight, borderTop: `1px solid ${theme.border}` }}>
                                            <h4 style={{ marginBottom: '20px', fontSize: '16px', fontWeight: 600 }}>標註者比較</h4>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
                                                {detail.annotators.map((annotator, annIdx) => (
                                                    <div key={annIdx} style={{
                                                        background: theme.bgPanel,
                                                        padding: '20px',
                                                        borderRadius: '12px',
                                                        border: `2px solid ${theme.border}`
                                                    }}>
                                                        <div style={{
                                                            marginBottom: '15px',
                                                            fontWeight: 700,
                                                            fontSize: '16px',
                                                            color: theme.primary,
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '8px',
                                                            justifyContent: 'space-between'
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                <span style={{ fontSize: '20px' }}>👤</span>
                                                                {annotator.username || annotator.user_id}
                                                            </div>
                                                            {annotator.persist_answer && (
                                                                <span style={{
                                                                    background: '#fef3c7',
                                                                    color: '#92400e',
                                                                    padding: '4px 10px',
                                                                    borderRadius: '12px',
                                                                    fontSize: '11px',
                                                                    fontWeight: 600,
                                                                    whiteSpace: 'nowrap'
                                                                }} title={annotator.reannotation_comment || '此標註者堅持原始答案'}>
                                                                    ✋ 堅持答案
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '14px', lineHeight: '2' }}>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                <strong>承諾:</strong>
                                                                <span>{annotator.promise_status || 'N/A'}</span>
                                                            </div>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                <strong>時間:</strong>
                                                                <span>{annotator.verification_timeline || 'N/A'}</span>
                                                            </div>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                <strong>證據:</strong>
                                                                <span>{annotator.evidence_status || 'N/A'}</span>
                                                            </div>
                                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                                <strong>品質:</strong>
                                                                <span>{annotator.evidence_quality || 'N/A'}</span>
                                                            </div>
                                                            {annotator.reannotation_comment && (
                                                                <div style={{
                                                                    marginTop: '10px',
                                                                    padding: '10px',
                                                                    background: '#f9fafb',
                                                                    borderRadius: '6px',
                                                                    borderLeft: '3px solid #f59e0b',
                                                                    fontSize: '13px'
                                                                }}>
                                                                    <div style={{ fontWeight: 600, marginBottom: '5px', color: '#92400e' }}>💬 備註：</div>
                                                                    <div style={{ color: '#374151', lineHeight: '1.5' }}>{annotator.reannotation_comment}</div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {/* 分頁控制 */}
                        {totalPages > 1 && (
                            <div style={{
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '10px',
                                marginTop: '30px',
                                paddingTop: '20px',
                                borderTop: `1px solid ${theme.border}`
                            }}>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                                    disabled={currentPage === 1}
                                    style={{ opacity: currentPage === 1 ? 0.5 : 1 }}
                                >
                                    ← 上一頁
                                </button>
                                <span style={{ fontSize: '14px', color: theme.text }}>
                                    第 {currentPage} / {totalPages} 頁
                                    <span style={{ color: theme.textSecondary, marginLeft: '10px' }}>
                                        (顯示 {startIndex + 1}-{Math.min(endIndex, totalItems)} 筆)
                                    </span>
                                </span>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                                    disabled={currentPage === totalPages}
                                    style={{ opacity: currentPage === totalPages ? 0.5 : 1 }}
                                >
                                    下一頁 →
                                </button>
                            </div>
                        )}
                    </div>
                );
            })()}

        </div>
    );
}
