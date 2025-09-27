// ==UserScript==
// @name         Wayground Solver (Tự động)
// @version      5.0
// @description  Tự động tìm mã PIN, tải đáp án và giải bài tập trên Wayground. Hỗ trợ MCQ/MSQ/BLANK.
// @author       Trần Bảo Ngọc & AI Assistant
// @namespace    http://tampermonkey.net/
// @match        https://wayground.com/*
// @grant        GM_addStyle
// @run-at       document-end
// @icon         https://i.imgur.com/b5rB3vo.png
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================================
    // ==                             PHẦN GIAO DIỆN (UI)                            ==
    // =================================================================================

    GM_addStyle(`
        #solver-panel {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 999999;
            padding: 12px;
            background-color: rgba(26, 27, 30, 0.85);
            backdrop-filter: blur(10px);
            border-radius: 16px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
            min-width: 260px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        #solver-status {
            color: white;
            font-size: 15px;
            font-weight: 600;
            text-align: center;
            margin-bottom: 10px;
            transition: all 0.3s ease;
        }
        #pin-container {
            display: flex;
            gap: 8px;
        }
        #pin-input {
            flex-grow: 1;
            border: 1px solid rgba(255, 255, 255, 0.2);
            background-color: rgba(0, 0, 0, 0.3);
            color: white;
            border-radius: 8px;
            padding: 8px 12px;
            font-size: 14px;
            outline: none;
            text-align: center;
            transition: all 0.2s ease;
        }
        #pin-input:focus {
            border-color: #a78bfa;
        }
        #load-btn {
            background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%);
            border: none;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            padding: 0 20px;
            cursor: pointer;
            transition: transform 0.2s ease, background 0.2s ease;
        }
        #load-btn:hover {
            transform: scale(1.05);
        }
        #load-btn:disabled {
            cursor: not-allowed;
            background: #555;
        }
    `);

    // =================================================================================
    // ==                              PHẦN LOGIC CHÍNH                               ==
    // =================================================================================

    /**
     * @description Map lưu trữ đáp án, với key là ID của câu hỏi và value là đáp án.
     */
    const cachedAnswers = new Map();
    let lastProcessedQuestionId = '';

    /**
     * @description Dọn dẹp thẻ HTML và khoảng trắng thừa khỏi văn bản.
     * @param {string} text - Chuỗi đầu vào.
     * @returns {string} Chuỗi đã được làm sạch.
     */
    const cleanText = (text) => text?.replace(/<p>|<\/p>/g, '').trim().replace(/\s+/g, ' ') || '';

    /**
     * @description Quét trang để tìm mã PIN game theo định dạng 'xxxx xxxx'.
     * @returns {string|null} Mã PIN 8 chữ số hoặc null nếu không tìm thấy.
     */
    function findGamePin() {
        const pinRegex = /\b(\d{4})\s(\d{4})\b/;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
            const match = node.nodeValue.trim().match(pinRegex);
            // Kiểm tra xem phần tử có đang hiển thị trên màn hình không
            if (match && node.parentElement?.offsetParent !== null) {
                return match[0].replace(/\s/g, '');
            }
        }
        return null;
    }

    /**
     * @description Tải và lưu đáp án từ API vào `cachedAnswers`.
     * @param {string} pin - Mã PIN của game.
     * @param {HTMLElement} statusDisplay - Phần tử để hiển thị trạng thái.
     * @returns {Promise<boolean>} True nếu thành công, False nếu thất bại.
     */
    async function fetchAndCacheAnswers(pin, statusDisplay) {
        statusDisplay.textContent = `🌀 Đang tải đáp án...`;
        try {
            const response = await fetch(`https://api.quizit.online/quizizz/answers?pin=${pin}`);
            if (!response.ok) throw new Error(`API Response: ${response.status}`);
            const { data } = await response.json();
            if (!data?.answers) throw new Error("Respone API không hợp lệ.");

            data.answers.forEach(item => {
                const questionId = item._id;
                if (!questionId) return;

                if (item.type === 'MSQ' && Array.isArray(item.answers)) {
                    const multiAnswers = item.answers.map(ans => cleanText(ans.text)).filter(Boolean);
                    if (multiAnswers.length > 0) cachedAnswers.set(questionId, multiAnswers);
                } else {
                    const singleAnswer = cleanText(item.answers?.[0]?.text);
                    if (singleAnswer) cachedAnswers.set(questionId, singleAnswer);
                }
            });

            if (cachedAnswers.size > 0) return true;
            throw new Error("API không trả về đáp án nào.");
        } catch (error) {
            statusDisplay.textContent = `❌ Lỗi: ${error.message}`;
            statusDisplay.style.color = '#ff5555'; // Màu đỏ lỗi
            return false;
        }
    }

    /**
     * @description Trích xuất ID, loại và các tùy chọn của câu hỏi hiện tại trên màn hình.
     * @returns {object|null} Dữ liệu câu hỏi hoặc null nếu không tìm thấy.
     */
    function getCurrentQuestionData() {
        const questionContainer = document.querySelector('[data-quesid]');
        if (!questionContainer) return null;
        const questionId = questionContainer.dataset.quesid;

        const options = Array.from(document.querySelectorAll('.option.is-selectable')).map(el => ({
            text: cleanText(el.querySelector('.option-text-inner, .text-container')?.innerText),
            element: el,
        }));

        if (options.length > 0) {
            return { questionId, type: 'CHOICE', options };
        }
        if (document.querySelector('input.question-input, textarea.question-input, input[type="text"], textarea')) {
            return { questionId, type: 'BLANK' };
        }
        return null;
    }
    
    /**
     * @description Thực hiện hành động giải câu hỏi (chọn/điền đáp án và submit).
     * @param {string|string[]} answer - Đáp án đúng.
     * @param {object} questionData - Dữ liệu câu hỏi từ `getCurrentQuestionData`.
     */
    function solveQuestion(answer, questionData) {
        const submit = () => setTimeout(() => {
            const submitBtn = Array.from(document.querySelectorAll('button')).find(btn => btn.innerText.trim().toLowerCase() === 'submit') 
                             || document.querySelector('.submit-button-wrapper button, button.submit-btn');
            if (submitBtn && !submitBtn.disabled) submitBtn.click();
        }, 350);

        if (questionData.type === 'CHOICE') {
            const answersToClick = Array.isArray(answer) ? answer : [answer];
            answersToClick.forEach(ansText => {
                const correctOption = questionData.options.find(opt => opt.text === ansText);
                if (correctOption) {
                    correctOption.element.style.border = '4px solid #00FF00';
                    correctOption.element.click();
                }
            });
            if (Array.isArray(answer)) submit(); // Chỉ submit cho câu hỏi nhiều đáp án (MSQ)
        } 
        else if (questionData.type === 'BLANK') {
            const inputEl = document.querySelector('input.question-input, textarea.question-input, input[type="text"], textarea');
            if (inputEl) {
                inputEl.value = answer;
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                submit();
            }
        }
    }

    /**
     * @description Controller chính: Lấy dữ liệu câu hỏi, tìm đáp án và gọi hàm giải.
     */
    async function mainSolver(statusDisplay) {
        if (cachedAnswers.size === 0) return;
        const questionData = getCurrentQuestionData();
        if (!questionData?.questionId) return;

        const answer = cachedAnswers.get(questionData.questionId);
        if (answer) {
            statusDisplay.textContent = "✅ Đã giải xong";
            solveQuestion(answer, questionData);
            setTimeout(() => { statusDisplay.textContent = "🚀 Đang chờ câu hỏi mới xuất hiện"; }, 1200);
        } else {
            statusDisplay.textContent = "❓ Không tìm thấy đáp án";
        }
    }

    /**
     * @description Theo dõi sự thay đổi trên trang để phát hiện câu hỏi mới.
     */
    function startObserver(statusDisplay) {
        const observer = new MutationObserver(() => {
            const questionContainer = document.querySelector('[data-quesid]');
            const currentQuestionId = questionContainer?.dataset.quesid;
            if (currentQuestionId && currentQuestionId !== lastProcessedQuestionId) {
                lastProcessedQuestionId = currentQuestionId;
                setTimeout(() => mainSolver(statusDisplay), 500);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    /**
     * @description Khởi tạo giao diện và các trình xử lý sự kiện.
     */
    function initialize() {
        if (document.getElementById('solver-panel')) return;
        document.body.insertAdjacentHTML('beforeend', `
            <div id="solver-panel">
                <div id="solver-status">🔎 Đang tìm mã Room Code...</div>
                <div id="pin-container">
                    <input type="text" id="pin-input" placeholder="Chờ chút...">
                    <button id="load-btn">Tải</button>
                </div>
            </div>
        `);

        const loadBtn = document.getElementById('load-btn');
        const pinInput = document.getElementById('pin-input');
        const statusDisplay = document.getElementById('solver-status');
        const pinContainer = document.getElementById('pin-container');

        const handleLoad = async () => {
            const pin = pinInput.value.trim().replace(/\s/g, '');
            if (!pin) return;

            loadBtn.disabled = true;
            pinInput.disabled = true;

            const success = await fetchAndCacheAnswers(pin, statusDisplay);
            if (success) {
                pinContainer.style.display = 'none';
                statusDisplay.textContent = "🚀 Sẵn sàng!";
                startObserver(statusDisplay);
            } else { // Nếu thất bại, cho phép thử lại
                loadBtn.disabled = false;
                pinInput.disabled = false;
            }
        };

        loadBtn.addEventListener('click', handleLoad);
        pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleLoad(); });

        // Tự động tìm PIN
        const pinFinderInterval = setInterval(() => {
            const foundPin = findGamePin();
            if (foundPin) {
                clearInterval(pinFinderInterval);
                pinInput.value = foundPin;
                statusDisplay.textContent = "✅ Đã tìm thấy Room Code ";
                statusDisplay.style.color = '#50fa7b';
                setTimeout(handleLoad, 500); // Tự động tải
            }
        }, 1000);

        setTimeout(() => clearInterval(pinFinderInterval), 20000); // Dừng tìm sau 15s
    }

    // Đợi trang tải xong một chút rồi mới chạy script
    window.addEventListener('load', () => setTimeout(initialize, 1000));

})();