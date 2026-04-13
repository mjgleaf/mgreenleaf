import { useState, useEffect } from 'react';

function ConversionCalculator() {
    const [inputValue, setInputValue] = useState('');
    const [fromUnit, setFromUnit] = useState('lbs');
    const [toUnit, setToUnit] = useState('kg');
    const [result, setResult] = useState(null);

    const units = {
        lbs: { label: 'Pounds (lbs)', type: 'weight' },
        kg: { label: 'Kilograms (kg)', type: 'weight' },
        tons: { label: 'Short Tons (US)', type: 'weight' },
        mtons: { label: 'Metric Tons (t)', type: 'weight' },
        ft: { label: 'Feet (ft)', type: 'length' },
        m: { label: 'Meters (m)', type: 'length' }
    };

    const convert = (val, from, to) => {
        if (!val || isNaN(val)) return null;
        let baseValue;

        switch (from) {
            case 'lbs': baseValue = val * 0.45359237; break;
            case 'kg': baseValue = val; break;
            case 'tons': baseValue = val * 907.18474; break;
            case 'mtons': baseValue = val * 1000; break;
            case 'ft': baseValue = val * 0.3048; break;
            case 'm': baseValue = val; break;
            default: return null;
        }

        switch (to) {
            case 'lbs': return baseValue / 0.45359237;
            case 'kg': return baseValue;
            case 'tons': return baseValue / 907.18474;
            case 'mtons': return baseValue / 1000;
            case 'ft': return baseValue / 0.3048;
            case 'm': return baseValue;
            default: return null;
        }
    };

    useEffect(() => {
        const res = convert(parseFloat(inputValue), fromUnit, toUnit);
        setResult(res);
    }, [inputValue, fromUnit, toUnit]);

    const handleSwap = () => {
        const temp = fromUnit;
        setFromUnit(toUnit);
        setToUnit(temp);
    };

    return (
        <div className="conversion-card">
            <h3>Quick Conversion Calculator</h3>
            <div className="conversion-grid">
                <div className="conversion-input-group">
                    <label>From</label>
                    <select
                        className="unit-select"
                        value={fromUnit}
                        onChange={(e) => setFromUnit(e.target.value)}
                    >
                        {Object.entries(units).map(([key, unit]) => (
                            <option key={key} value={key}>{unit.label}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        className="conversion-field"
                        placeholder="Enter value..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                    />
                </div>

                <button className="swap-btn" onClick={handleSwap} title="Swap Units">
                    &#8644;
                </button>

                <div className="conversion-input-group">
                    <label>To</label>
                    <select
                        className="unit-select"
                        value={toUnit}
                        onChange={(e) => setToUnit(e.target.value)}
                    >
                        {Object.entries(units)
                            .filter(([key, unit]) => unit.type === units[fromUnit].type)
                            .map(([key, unit]) => (
                                <option key={key} value={key}>{unit.label}</option>
                            ))}
                    </select>
                    <div className="conversion-field" style={{ background: 'rgba(255,255,255,0.05)', color: result !== null ? 'var(--yellow-accent)' : 'var(--text-secondary)' }}>
                        {result !== null ? result.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '---'}
                    </div>
                </div>
            </div>
            {result !== null && (
                <div className="conversion-result">
                    <div className="result-label">Result</div>
                    <div className="result-value">
                        {inputValue} {fromUnit} = {result.toLocaleString(undefined, { maximumFractionDigits: 3 })} {toUnit}
                    </div>
                </div>
            )}
        </div>
    );
}

export default ConversionCalculator;
