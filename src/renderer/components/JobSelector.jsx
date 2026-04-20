function JobSelector({ jobs, activeJobId, selectedSharePointJob, onSelect }) {
    const hasJobs = jobs && jobs.length > 0;
    if (!hasJobs && !selectedSharePointJob) return null;

    const spJobNum = selectedSharePointJob?.QuoteNum || selectedSharePointJob?.jobNumber;
    const hasMatchingLocal = spJobNum && jobs.some(j => j.metadata?.jobNumber === spJobNum);
    const showStub = selectedSharePointJob && !hasMatchingLocal;
    const stubValue = `__sp__:${spJobNum || 'selected'}`;
    const selectValue = activeJobId ?? (showStub ? stubValue : '');

    return (
        <div className="job-selector-container">
            <label>Current Job Data:</label>
            <select
                value={selectValue}
                onChange={(e) => {
                    if (e.target.value.startsWith('__sp__:')) return;
                    onSelect(e.target.value);
                }}
                className="job-dropdown"
            >
                {showStub && (
                    <option value={stubValue} disabled>
                        {spJobNum} — no data imported
                    </option>
                )}
                {jobs.map(job => (
                    <option key={job.id} value={job.id}>
                        {job.metadata.jobNumber || `Unnamed Job (${new Date(job.id).toLocaleDateString()})`}
                    </option>
                ))}
            </select>
            <span className="job-count-badge">{jobs.length} loaded</span>
        </div>
    );
}

export default JobSelector;
