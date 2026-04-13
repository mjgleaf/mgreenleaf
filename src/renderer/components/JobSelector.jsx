function JobSelector({ jobs, activeJobId, onSelect }) {
    if (!jobs || jobs.length === 0) return null;

    return (
        <div className="job-selector-container">
            <label>Current Job Data:</label>
            <select
                value={activeJobId}
                onChange={(e) => onSelect(e.target.value)}
                className="job-dropdown"
            >
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
