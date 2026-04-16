document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const recordBtn = document.getElementById('recordBtn');
    const stopBtn = document.getElementById('stopBtn');
    const summarizeBtn = document.getElementById('summarizeBtn');
    const transcriptEl = document.getElementById('transcript');
    const statusText = document.getElementById('statusText');
    const statusDot = document.querySelector('.status-dot');
    
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsBtn = document.getElementById('closeSettingsBtn');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const apiKeyInput = document.getElementById('apiKey');
    const currentModelDisplay = document.getElementById('currentModelDisplay');
    
    const loadingOverlay = document.getElementById('loadingOverlay');
    const resultSection = document.getElementById('resultSection');
    const resultItems = document.getElementById('resultItems');

    const copyTranscriptBtn = document.getElementById('copyTranscriptBtn');
    copyTranscriptBtn.classList.remove('hidden');

    // State
    let recognition = null;
    let finalTranscript = '';
    let isRecording = false;
    let activeModel = 'gemini-3-flash'; // Fallback

    // Load API Key & Init Models
    const savedApiKey = localStorage.getItem('memo_gemini_api_key');
    if (savedApiKey) {
        apiKeyInput.value = savedApiKey;
        autoSelectBestModel(savedApiKey);
    }

    // Settings Modal Handlers
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('hidden');
    });

    closeSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('hidden');
    });

    async function autoSelectBestModel(key) {
        try {
            currentModelDisplay.textContent = "最新モデルを解析中...";
            const response = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${key}`);
            if (!response.ok) throw new Error("モデル取得失敗");
            
            const data = await response.json();
            
            // 1. 要約(generateContent)が使えるGeminiモデルを抽出
            let geminiModels = data.models
                .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                .map(m => m.name.replace('models/', ''))
                .filter(name => name.startsWith('gemini-'));

            // 2. 数値・文字形式でソート（最新バージョンが後ろに来るように）
            geminiModels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

            // 3. 最新の「Flash系（無料枠に強い型）」を最優先、なければ最新モデルを選択
            // 将来的には 'flash' 以外の名称になる可能性も考慮し、
            // 最新の上位数件の中からキーワードにマッチするものを探す
            const candidates = geminiModels.slice(-5).reverse(); // 最新から5つを候補に
            let bestModel = candidates.find(name => name.includes('flash')) || candidates[0];

            if (bestModel) {
                activeModel = bestModel;
                localStorage.setItem('memo_gemini_model_name', activeModel);
                currentModelDisplay.textContent = `自動選択(無料優先): ${activeModel}`;
                console.log("Auto-selected best free-tier model:", activeModel);
            }
        } catch (err) {
            console.error(err);
            activeModel = localStorage.getItem('memo_gemini_model_name') || 'gemini-3-flash';
            currentModelDisplay.textContent = `前回のモデルを使用: ${activeModel}`;
        }
    }

    saveSettingsBtn.addEventListener('click', () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            localStorage.setItem('memo_gemini_api_key', key);
            autoSelectBestModel(key);
        } else {
            localStorage.removeItem('memo_gemini_api_key');
            currentModelDisplay.textContent = "APIキーを入力してください";
        }
        settingsModal.classList.add('hidden');
    });

    // Transcript Copy Button Listener
    copyTranscriptBtn.addEventListener('click', async () => {
        const text = transcriptEl.innerText.replace('マイクボタンを押して話し始めてください...', '').trim();
        if (!text) return;
        
        try {
            await navigator.clipboard.writeText(text);
            const originalHTML = copyTranscriptBtn.innerHTML;
            copyTranscriptBtn.innerHTML = '<i class="ph ph-check" style="color:#10b981;"></i>';
            setTimeout(() => {
                copyTranscriptBtn.innerHTML = originalHTML;
            }, 2000);
        } catch (err) {
            console.error("Failed to copy", err);
        }
    });

    // Web Speech API Setup
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        statusText.textContent = "未対応ブラウザです";
        recordBtn.disabled = true;
    } else {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'ja-JP';

        recognition.onstart = () => {
            isRecording = true;
            statusText.textContent = "録音中...";
            statusDot.classList.add('recording');
            recordBtn.classList.add('hidden');
            stopBtn.classList.remove('hidden');
            summarizeBtn.disabled = true;
        };

        recognition.onresult = (event) => {
            let interimTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                } else {
                    interimTranscript += event.results[i][0].transcript;
                }
            }
            
            transcriptEl.innerHTML = finalTranscript + '<i style="color:var(--text-secondary)">' + interimTranscript + '</i>';
            transcriptEl.classList.remove('placeholder');
            
            const container = transcriptEl.parentElement;
            container.scrollTop = container.scrollHeight;
        };

        recognition.onerror = (event) => {
            console.error("Speech recognition error", event.error);
            if (event.error === 'not-allowed') {
                statusText.textContent = "マイク使用を許可してください";
            } else {
                statusText.textContent = "エラー: " + event.error;
            }
            stopRecording();
        };

        recognition.onend = () => {
            isRecording = false;
            statusText.textContent = "待機中";
            statusDot.classList.remove('recording');
            recordBtn.classList.remove('hidden');
            stopBtn.classList.add('hidden');
            
            if (finalTranscript.trim().length > 0) {
                summarizeBtn.disabled = false;
            }
        };
    }

    function startRecording() {
        if (!recognition) return;
        
        if (!localStorage.getItem('memo_gemini_api_key')) {
            statusText.textContent = "APIキーを設定してください";
            settingsModal.classList.remove('hidden');
            return;
        }

        finalTranscript = ''; 
        transcriptEl.innerHTML = '';
        resultSection.classList.add('hidden');
        try {
            recognition.start();
        } catch (e) {
            console.error("Recognition start error", e);
        }
    }

    function stopRecording() {
        if (recognition && isRecording) {
            recognition.stop();
        }
    }

    // Listeners
    recordBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);

    // AI Summarization (Gemini)
    summarizeBtn.addEventListener('click', async () => {
        const apiKey = localStorage.getItem('memo_gemini_api_key');
        if (!apiKey) {
            alert("Gemini APIキーが設定されていません。");
            settingsModal.classList.remove('hidden');
            return;
        }

        const textToSummarize = transcriptEl.innerText;
        if (!textToSummarize) return;

        loadingOverlay.classList.remove('hidden');
        resultSection.classList.add('hidden');
        summarizeBtn.disabled = true;

        try {
            const modelName = localStorage.getItem('memo_gemini_model_name') || 'gemini-3-flash';
            const prompt = `
以下の音声文字起こしテキストを解析し、内容を要約してください。
また、今後の具体的なアクションを「対応フロー」として箇条書きのリスト形式で作成してください。

出力は純粋なJSON形式のみで行ってください。
【フォーマット】
{
    "summary": "内容の要約（簡潔に）",
    "workflow": ["ステップ1", "ステップ2", "ステップ3...", ...]
}

【テキスト】
${textToSummarize}
`;
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${modelName}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: prompt
                        }]
                    }]
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error?.message || 'API Request Failed');
            }

            const result = await response.json();
            const responseText = result.candidates[0].content.parts[0].text;
            
            const jsonText = responseText.replace(/```json\n?|```/g, '').trim();
            const data = JSON.parse(jsonText);
            
            displayResults(data, textToSummarize);

        } catch (error) {
            console.error("Gemini API Error:", error);
            alert("要約中にエラーが発生しました。\n詳細: " + error.message);
        } finally {
            loadingOverlay.classList.add('hidden');
            summarizeBtn.disabled = false;
        }
    });

    function displayResults(data, fullTranscript) {
        resultItems.innerHTML = '';
        
        // 1. Summary Section
        const summaryItem = document.createElement('div');
        summaryItem.className = 'result-item';
        summaryItem.innerHTML = `
            <div class="result-label"><i class="ph ph-text-align-left"></i> 要約</div>
            <div class="result-text main-summary">${data.summary}</div>
        `;
        resultItems.appendChild(summaryItem);

        // 2. Workflow Section
        const workflowItem = document.createElement('div');
        workflowItem.className = 'result-item';
        const workflowList = (data.workflow || []).map(step => `<li>${step}</li>`).join('');
        workflowItem.innerHTML = `
            <div class="result-label"><i class="ph ph-list-checks"></i> 対応フロー</div>
            <div class="result-text">
                <ul class="workflow-list">${workflowList}</ul>
            </div>
        `;
        resultItems.appendChild(workflowItem);

        // 3. Copy All Button
        const copyAllBtnWrapper = document.createElement('div');
        copyAllBtnWrapper.style.marginTop = '2rem';
        copyAllBtnWrapper.style.textAlign = 'center';

        const copyAllBtn = document.createElement('button');
        copyAllBtn.className = 'primary-btn';
        copyAllBtn.style.width = '100%';
        copyAllBtn.innerHTML = '<i class="ph ph-copy"></i> 要約・フロー・全文をコピー';
        
        copyAllBtn.addEventListener('click', async () => {
            const workflowText = (data.workflow || []).map(step => `・${step}`).join('\n');
            const copyText = `【要約】\n${data.summary}\n\n【対応フロー】\n${workflowText}\n\n【全文】\n${fullTranscript}`;
            
            try {
                await navigator.clipboard.writeText(copyText);
                const originalHTML = copyAllBtn.innerHTML;
                copyAllBtn.innerHTML = '<i class="ph ph-check"></i> コピーしました！';
                copyAllBtn.style.background = '#10b981';
                setTimeout(() => {
                    copyAllBtn.innerHTML = originalHTML;
                    copyAllBtn.style.background = '';
                }, 2000);
            } catch (err) {
                console.error("Failed to copy", err);
            }
        });

        copyAllBtnWrapper.appendChild(copyAllBtn);
        resultItems.appendChild(copyAllBtnWrapper);

        resultSection.classList.remove('hidden');
        resultSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // --- Keyboard Shortcut ---
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (!settingsModal.classList.contains('hidden')) return;
            if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

            e.preventDefault();
            if (!isRecording) {
                startRecording();
            } else {
                stopRecording();
            }
        }
    });
});
