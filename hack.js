// ==UserScript==
// @name         Hack Wayground
// @author       Trần Bảo Ngọc
// @namespace    http://tampermonkey.net/
// @match        https://wayground.com/*
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @grant        GM_addStyle
// @run-at       document-end
// @icon         https://blackarch.org/images/logo/ba-logo.png
// ==/UserScript==

(function() {
    'use strict';
    let cachedAnswers = new Map();
    let lastProcessedQuestionText = '';
    const cleanText = (text) => text?.replace(/<p>|<\/p>/g, '').trim().replace(/\s+/g, ' ') || '';
    async function fetchAndCacheAnswers(pin, statusDisplay) {
        statusDisplay.textContent = `🌀 Đang tải đáp án !`;
        const API_URL = `https://api.quizit.online/quizizz/answers?pin=${pin}`;
        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(`Lỗi API ${response.status}`);

            const responseData = await response.json();
            if (!responseData?.data?.answers) throw new Error("Cấu trúc dữ liệu API không hợp lệ.");

            responseData.data.answers.forEach(item => {
                const questionText = cleanText(item.question?.text);
                const answerText = cleanText(item.answers?.[0]?.text);
                if (questionText && answerText) {
                    cachedAnswers.set(questionText, answerText);
                }
            });

            if (cachedAnswers.size > 0) return true;
            throw new Error("Không tìm thấy câu trả lời.");
        } catch (error) {
            statusDisplay.textContent = `❌ Lỗi: ${error.message}`;
            return false;
        }
    }

    function extrairDadosDaQuestao() {
        try {
            const questionTextElement = document.querySelector('.question-text-color');
            const questionText = cleanText(questionTextElement?.innerText);
            if (!questionText) return null;

            const optionElements = document.querySelectorAll('.option.is-selectable');
            if (optionElements.length > 0) {
                const extractText = (el) => cleanText(el.querySelector('.option-text-inner, .text-container')?.innerText);
                const options = Array.from(optionElements).map(el => ({ text: extractText(el), element: el }));
                return { questionText, questionType: 'choice', options };
            }

            const openEndedTextarea = document.querySelector('textarea[data-cy="open-ended-textarea"]');
            if (openEndedTextarea) {
                return { questionText, questionType: 'open_ended', answerElement: openEndedTextarea };
            }
            return null;
        } catch {
            return null;
        }
    }

    async function performAction(answerText, quizData) {
        if (!answerText) return;

        switch (quizData.questionType) {
            case 'choice':
                const correctOption = quizData.options.find(opt => opt.text === answerText);
                if (correctOption) {
                    correctOption.element.style.border = '5px solid #00FF00';
                    correctOption.element.click();
                }
                break;
            case 'open_ended':
                quizData.answerElement.value = answerText;
                quizData.answerElement.dispatchEvent(new Event('input', { bubbles: true }));
                setTimeout(() => document.querySelector('.submit-button-wrapper button, button.submit-btn')?.click(), 500);
                break;
        }
    }

    async function resolverQuestao(statusDisplay) {
        if (cachedAnswers.size === 0) return;
        const quizData = await extrairDadosDaQuestao();
        if (!quizData) return;

        const foundAnswer = cachedAnswers.get(quizData.questionText);

        if (foundAnswer) {
            statusDisplay.textContent = "Đã giải";
            await performAction(foundAnswer, quizData);
            setTimeout(() => { statusDisplay.textContent = "Đang tìm câu hỏi"; }, 1200);
        } else {
            statusDisplay.textContent = "❌ Không có đáp án";
        }
    }

    function startObserver(statusDisplay) {
        const observer = new MutationObserver(() => {
            const questionElement = document.querySelector('.question-text-color');
            const currentQuestionText = cleanText(questionElement?.innerText);

            if (currentQuestionText && currentQuestionText !== lastProcessedQuestionText) {
                lastProcessedQuestionText = currentQuestionText;
                setTimeout(() => resolverQuestao(statusDisplay), 500);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function initialize() {
        if (document.getElementById('mzzvxm-floating-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'mzzvxm-floating-panel';
        panel.innerHTML = `
            <div id="solver-status-display" style="color: white; font-size: 15px; font-weight: 600; text-align: center; margin-bottom: 10px; transition: color 0.3s;">Nhập mã PIN</div>
            <div id="pin-input-container" style="display: flex; gap: 8px;">
                <input type="text" id="pin-input-field" placeholder="Nhập mã PIN tại đây..." style="flex-grow: 1; border: 1px solid rgba(255,255,255,0.3); background-color: rgba(0,0,0,0.3); color: white; border-radius: 8px; padding: 8px 12px; font-size: 14px; outline: none; text-align: center;">
                <button id="load-answers-btn" style="background: linear-gradient(135deg, #a78bfa 0%, #8b5cf6 100%); border: none; border-radius: 8px; color: white; font-weight: 600; padding: 0 20px; cursor: pointer; transition: background 0.2s ease;">Tải</button>
            </div>
        `;
        Object.assign(panel.style, {
            position: 'fixed', bottom: '20px', right: '20px', zIndex: '2147483647',
            padding: '12px', backgroundColor: 'rgba(26, 27, 30, 0.8)',
            backdropFilter: 'blur(8px)', borderRadius: '16px',
            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.4)', minWidth: '250px'
        });
        document.body.appendChild(panel);

        const loadBtn = document.getElementById('load-answers-btn');
        const pinInput = document.getElementById('pin-input-field');
        const statusDisplay = document.getElementById('solver-status-display');
        const inputContainer = document.getElementById('pin-input-container');

        const handleLoad = async () => {
            const pin = pinInput.value.trim();
            if (!pin) {
                statusDisplay.textContent = "Hãy nhập mã PIN!";
                statusDisplay.style.color = '#ffb86c';
                setTimeout(() => {
                    statusDisplay.textContent = "Nhập mã PIN";
                    statusDisplay.style.color = 'white';
                }, 2000);
                return;
            }

            loadBtn.disabled = true;
            pinInput.disabled = true;
            const success = await fetchAndCacheAnswers(pin, statusDisplay);

            if (success) {
                inputContainer.style.display = 'none';
                statusDisplay.textContent = "✅ Đã Tải xong đáp án ";
                startObserver(statusDisplay);
            } else {
                loadBtn.disabled = false;
                pinInput.disabled = false;
            }
        };

        loadBtn.addEventListener('click', handleLoad);
        pinInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') handleLoad();
        });
    }

    setTimeout(initialize, 2000);
})();
