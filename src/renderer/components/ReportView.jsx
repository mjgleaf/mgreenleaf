import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import processChartData from '../utils/processChartData';
import { getElectronAPI } from '../utils/electronAPI';

const MAX_CHART_POINTS = 500;

function toRechartsData(chartData) {
    if (!chartData?.labels) return [];
    const total = chartData.labels.length;
    const step = total > MAX_CHART_POINTS ? Math.ceil(total / MAX_CHART_POINTS) : 1;
    const result = [];
    for (let i = 0; i < total; i += step) {
        const point = { time: parseFloat(chartData.labels[i]) };
        chartData.datasets.forEach(ds => {
            point[ds.label] = ds.data[i];
        });
        result.push(point);
    }
    return result;
}

function ReportView({ job, displayUnit = 'lbs', displayTimeUnit = 'min', onUnitChange, onTimeUnitChange, xUnit, onXUnitChange, onAddData, onRemoveDataSet, onClearAllData, onUpdateDataSet }) {
    if (!job || !job.dataSets || job.dataSets.length === 0) {
        return (
            <div className="placeholder-card">
                <p>No data imported or logged for this project.</p>
                <button onClick={onAddData} className="action-btn mt-4">Import CSV Data</button>
            </div>
        );
    }

    const handleExportCSV = async (dataSet) => {
        const jobNumber = job.metadata?.jobNumber || 'test_data';
        const fileName = dataSet.name || 'data_set';
        const result = await getElectronAPI().saveCSV(dataSet.data, `${jobNumber}_${fileName}`);
        if (result?.success) {
            console.log('CSV exported successfully:', result.filePath);
        } else if (result?.error) {
            alert(`Failed to export CSV: ${result.error}`);
        }
    };

    const palette = ['#1a3a6c', '#3fb950', '#2188ff', '#f85149', '#dbab09', '#8957e5'];
    const decimals = displayUnit === 'tons' ? 3 : 2;

    return (
        <div className="report-container">
            <div className="controls report-controls">
                <button onClick={onAddData} className="action-btn">
                    Add More Data
                </button>
                {job.dataSets.length > 1 && (
                    <button onClick={onClearAllData} className="action-btn secondary">
                        Clear All Data
                    </button>
                )}
                <div className="control-group">
                    <span className="control-label">Weight:</span>
                    <select value={displayUnit} onChange={e => onUnitChange(e.target.value)} className="control-select">
                        <option value="lbs">lbs</option>
                        <option value="tons">tons</option>
                    </select>
                </div>
                <div className="control-group">
                    <span className="control-label">Time:</span>
                    <select value={displayTimeUnit} onChange={e => onTimeUnitChange(e.target.value)} className="control-select">
                        <option value="min">min</option>
                        <option value="hrs">hrs</option>
                    </select>
                </div>
                <div className="control-group">
                    <span className="control-label">Time Axis:</span>
                    <select value={xUnit} onChange={e => onXUnitChange(e.target.value)} className="control-select">
                        <option value="min">Minutes</option>
                        <option value="hour">Hours</option>
                    </select>
                </div>
            </div>

            <div className="datasets-scroll-area">
                {job.dataSets.map((dataSet, index) => {
                    // Auto-detect time unit from headers if not explicitly set
                    let effectiveInputTimeUnit = dataSet.inputTimeUnit;
                    if (!effectiveInputTimeUnit && dataSet.data?.length > 0) {
                        const headers = Object.keys(dataSet.data[0]);
                        const timeHeader = headers.find(h => /elapsed|second/i.test(h)) || headers.find(h => /time|stamp/i.test(h)) || '';
                        if (/ms|millisecond/i.test(timeHeader)) effectiveInputTimeUnit = 'ms';
                        else if (/min/i.test(timeHeader)) effectiveInputTimeUnit = 'min';
                        else if (/hour|hr/i.test(timeHeader)) effectiveInputTimeUnit = 'hrs';
                        else effectiveInputTimeUnit = 'sec';
                    }
                    const stats = processChartData(dataSet.data, [], displayUnit, displayTimeUnit, effectiveInputTimeUnit || 'sec', xUnit, dataSet.chartMode || 'perCell');
                    if (!stats) return <div key={index}>Error processing data set {index + 1}</div>;

                    const rechartsData = toRechartsData(stats.chartData);

                    return (
                        <div key={index} className="dataset-block">
                            <div className="dataset-header">
                                <div className="dataset-meta">
                                    <div className="dataset-title-row">
                                        <span className="dataset-index">Graph #{index + 1}:</span>
                                        <input
                                            value={dataSet.name}
                                            onChange={(e) => onUpdateDataSet(index, { name: e.target.value })}
                                            className="dataset-name-input"
                                            placeholder="Graph Title..."
                                        />
                                    </div>
                                    <div className="dataset-options-row">
                                        <div className="dataset-option">
                                            <span className="dataset-option-label">Y-Axis Label:</span>
                                            <input
                                                value={dataSet.yAxisLabel || ''}
                                                onChange={(e) => onUpdateDataSet(index, { yAxisLabel: e.target.value })}
                                                className="dataset-option-input"
                                                placeholder={`Default: Weight (${displayUnit})`}
                                            />
                                        </div>
                                        <div className="dataset-option">
                                            <span className="dataset-option-label">Source Time Unit:</span>
                                            <select
                                                value={effectiveInputTimeUnit || 'sec'}
                                                onChange={(e) => onUpdateDataSet(index, { inputTimeUnit: e.target.value })}
                                                className="dataset-option-select"
                                            >
                                                <option value="sec">Seconds</option>
                                                <option value="min">Minutes</option>
                                                <option value="hrs">Hours</option>
                                                <option value="ms">Milliseconds</option>
                                            </select>
                                        </div>
                                        <div className="dataset-option">
                                            <span className="dataset-option-label">Chart Mode:</span>
                                            <select
                                                value={dataSet.chartMode || 'perCell'}
                                                onChange={(e) => onUpdateDataSet(index, { chartMode: e.target.value })}
                                                className="dataset-option-select"
                                            >
                                                <option value="perCell">Per Load Cell</option>
                                                <option value="combined">Combined Total</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div className="dataset-actions">
                                    <button onClick={() => handleExportCSV(dataSet)} className="action-btn small">
                                        Export CSV
                                    </button>
                                    <button onClick={() => onRemoveDataSet(index)} className="job-remove-btn static" title="Remove Data Set">
                                        &#10005;
                                    </button>
                                </div>
                            </div>

                            <div className="stats-grid">
                                <div className="stat-card">
                                    <h3>Maximum Weight</h3>
                                    <div className="stat-value">{stats.maxWeight.toFixed(decimals)} {displayUnit}</div>
                                </div>
                                <div className="stat-card">
                                    <h3>Total Duration</h3>
                                    <div className="stat-value">{stats.totalTime.toFixed(2)} {displayTimeUnit}</div>
                                </div>
                                <div className="stat-card">
                                    <h3>Peak Timestamp</h3>
                                    <div className="stat-value">{stats.peakTime || 'N/A'}</div>
                                </div>
                            </div>

                            <div className="chart-section">
                                <div className="chart-wrapper" style={{ width: '100%', height: '350px', minWidth: 0 }}>
                                    <ResponsiveContainer width="100%" height={350} minWidth={0}>
                                        <LineChart data={rechartsData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(33, 51, 77, 0.5)" />
                                            <XAxis
                                                dataKey="time"
                                                label={{ value: `Elapsed Time (${xUnit === 'hour' ? 'hr' : 'min'})`, position: 'insideBottom', offset: -5, fill: '#8b949e' }}
                                                tick={{ fill: '#8b949e' }}
                                                tickFormatter={v => v.toFixed(1)}
                                            />
                                            <YAxis
                                                label={{ value: dataSet.yAxisLabel || `Weight (${displayUnit})`, angle: -90, position: 'insideLeft', fill: '#8b949e' }}
                                                tick={{ fill: '#8b949e' }}
                                                domain={[0, stats.maxWeight * 1.1]}
                                            />
                                            <Tooltip
                                                formatter={(value) => [value.toFixed(decimals) + ` ${displayUnit}`, null]}
                                                contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: '6px' }}
                                                labelStyle={{ color: '#8b949e' }}
                                            />
                                            {stats.chartData.datasets.length > 1 && <Legend wrapperStyle={{ color: '#8b949e' }} />}
                                            {stats.chartData.datasets.map((ds, i) => (
                                                <Line
                                                    key={ds.label}
                                                    type="monotone"
                                                    dataKey={ds.label}
                                                    stroke={palette[i % palette.length]}
                                                    dot={false}
                                                    strokeWidth={2}
                                                    isAnimationActive={false}
                                                    fill={i === 0 && stats.chartData.datasets.length === 1 ? 'rgba(26, 58, 108, 0.1)' : 'none'}
                                                />
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="data-preview mt-4">
                                <details>
                                    <summary className="data-preview-summary">Show Raw Data ({dataSet.data.length} rows)</summary>
                                    <div className="table-wrapper data-preview-table">
                                        <table>
                                            <thead>
                                                <tr>
                                                    {Object.keys(dataSet.data[0] || {}).map(key => <th key={key}>{key}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dataSet.data.slice(0, 50).map((row, i) => (
                                                    <tr key={i}>
                                                        {Object.values(row).map((val, j) => <td key={j}>{val}</td>)}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export default ReportView;
