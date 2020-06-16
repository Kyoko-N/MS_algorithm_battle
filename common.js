"use strict";
/*
 * This file is specifically for the summer internship challenge.
 */
function globalEval() {
    return eval(arguments[0]);
}

$(function () {
    var $           = window.jQuery;
    var jQuery      = window.jQuery;
    var CodeMirror  = window.CodeMirror;
    var ClipboardJS = window.ClipboardJS;
    var globalEval  = window.globalEval;
    var gtag        = window.gtag;

    var quotes         = []; // quotes[stock][time] == price
    var tradeTable     = []; // tradeTable[time][i] == trade
    var tradeList      = []; // tradeList[tradeID] == trade
    var charts         = []; // charts[stock] == chart
    var plotBandRanges = []; // plotBandRanges[stock] == chart.xAxis[0].plotBands

    var missionConfigs = [{
        numStocks: 1,
        endTime: 64,
        initialBalance: 10000,
        targetBalance: 100000,
        volatility: 0.1,
        validationScore: 100000
    }, {
        numStocks: 3,
        endTime: 64,
        initialBalance: 10000,
        targetBalance: 1000000,
        volatility: 0.1,
        validationScore: 1000000
    }, {
        numStocks: 3,
        endTime: 512,
        initialBalance: 10000,
        targetBalance: 100000000,
        volatility: 0.059,
        validationScore: 1000000,

        /* Custom Rules */
        //maxPosition: 10000, // 2018
        //minInterval: 10, // 2018
        commissionRate: 0.05,
        maxTradeQuantity: 10000
    }];

    var lang = 'ja';
    var langSubdirectory = false;

    if (location.pathname.match(/\/(\w{2})\/[^\/]*$/)) {
        lang = RegExp.$1;
        langSubdirectory = true;
    }

    var amountUnits = (lang == 'en' ? [] : [
        {label: '兆', value: Math.pow(10000, 3)},
        {label: '億', value: Math.pow(10000, 2)},
        {label: '万', value: Math.pow(10000, 1)}
    ]);

    var maxManualTrades = 100;

    $('.interactive').show();
    $('.non-interactive').hide();

    var interruptTasks = [];
    var initTimer = null;

    interruptTasks.push(function () {
        if (initTimer) {
            clearTimeout(initTimer);
            initTimer = null;
        }
    });

    var localStorage = window.localStorage;
    var sessionStorage = window.sessionStorage;

    var request = (function () {
        var request = {};

        function readChunks(chunks) {
            for (var i = 0; i < chunks.length; i++) {
                var pair = chunks[i].split(/=/, 2);
                var name = decodeURIComponent(pair[0]);
                var value = decodeURIComponent(pair[1]);
                request[name] = value;
            }
        }

        if (sessionStorage) {
            for (var i = 0; i < sessionStorage.length; i++) {
                var name = sessionStorage.key(i);
                var value = sessionStorage.getItem(name);
                request[name] = value;
            }
        }

        if (document.cookie) {
            readChunks(document.cookie.split(/\s*;\s*/));
        }

        if (location.search != '') {
            readChunks(location.search.replace(/^\?/, '').split(/&/));
        }

        return request;
    })();

    var currentMission = 0;
    var loadTime = new Date().getTime();
    var defaultSeed = 123456;
    var currentSeed = defaultSeed;

    if (request) {
        if (request.test) {
            currentMission = missionConfigs.length - 1;
        } else if (request.mission) {
            currentMission = parseInt(request.mission) - 1;
        }

        if (request.seed) {
            currentSeed = parseInt(request.seed);
        } else if (request.random) {
            currentSeed = loadTime;
        }
    }

    var endTime          = missionConfigs[currentMission].endTime;
    var numStocks        = missionConfigs[currentMission].numStocks;
    var initialBalance   = missionConfigs[currentMission].initialBalance;
    var targetBalance    = missionConfigs[currentMission].targetBalance;
    var volatility       = missionConfigs[currentMission].volatility;
    var validationScore  = missionConfigs[currentMission].validationScore;
    var maxPosition      = missionConfigs[currentMission].maxPosition;
    var minInterval      = missionConfigs[currentMission].minInterval;
    var commissionRate   = missionConfigs[currentMission].commissionRate;
    var maxTradeQuantity = missionConfigs[currentMission].maxTradeQuantity;

    var currentOverride = null;

    var splashDuration = 1500;
    var isRanking = $('#ranking_board').length > 0;

    var scriptEditor;
    var isMobile = navigator.userAgent.match(/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i);

    function setup(override) {
        // Run all recovery tasks
        for (var i = 0; i < interruptTasks.length; i++) {
            interruptTasks[i]();
        }

        var config = {};

        for (var key in missionConfigs[currentMission]) {
            config[key] = missionConfigs[currentMission][key];
        }

        if (override) {
            for (var key in override) {
                config[key] = override[key];
            }
        }

        // Update mission-specific variables
        numStocks        = config.numStocks;
        endTime          = config.endTime;
        initialBalance   = config.initialBalance;
        targetBalance    = config.targetBalance;
        volatility       = config.volatility;
        validationScore  = config.validationScore;
        maxPosition      = config.maxPosition;
        minInterval      = config.minInterval;
        commissionRate   = config.commissionRate;
        maxTradeQuantity = config.maxTradeQuantity;

        tradeTable = [];
        tradeList = [];

        // Initialize prices
        var rand = seed(currentSeed);
        quotes = [];

        for (var s = 0; s < numStocks; s++) {
            var prices = [];
            var price = 1000;
            var targetPrice = meanReversionYield * price;

            for (var t = 0; t < endTime; t++) {
                var mean = meanReversionFactor * Math.log(targetPrice / price);
                price *= Math.exp(mean + volatility * norminv(rand()));
                prices.push(Math.round(price));
            }

            quotes[s] = prices;
        }

        // Initialize plotBandRanges
        plotBandRanges = [];

        for (var s = 0; s < numStocks; s++) {
            plotBandRanges[s] = [];
        }

        initTimer = setTimeout(function () {
            initTimer = null;
            renderComponents();
            setCalculateTime(0);
        }, 0);
    }

    function setOverride(override) {
        currentOverride = override;
        setup(override);
    }

    var lastManualTrade = null;
    var lenientMode     = false;

    var initialString = formatAmount(initialBalance);
    var targetString  = formatAmount(targetBalance);
    var popupMessage  = '';

    var keyboardHandlers = [];
    var keyboardHook = null;
    var preventShiftEnter = false;
    var preventShiftEnterTimer = null;
    var ENTER_KEY = 13;
    var SPACE_KEY = 20;
    var ESC_KEY = 27;

    $(window).keydown(function (event) {
        var inTextBox = event.target.tagName.match(/^(?:textarea|input)$/i);
        var shiftKey = (event.shiftKey && !(event.ctrlKey || event.metaKey || event.altKey));

        if (shiftKey && event.keyCode == ENTER_KEY) {
            if (!preventShiftEnter) {
                if (inTextBox) {
                    executeScript();
                } else {
                    editScript();
                }
            }

            // Prevent Shift+Enter from repeating too frequently
            preventShiftEnter = true;

            if (preventShiftEnterTimer) {
                clearTimeout(preventShiftEnterTimer);
                preventShiftEnterTimer = null;
            }

            preventShiftEnterTimer = setTimeout(function () {
                preventShiftEnter = false;
                preventShiftEnterTimer = null;
            }, 400);

            return false;
        } else if (event.keyCode == ESC_KEY) {
            hideAlertPopup();
        }

        if (keyboardHandlers[event.keyCode] && !inTextBox) {
            keyboardHandlers[event.keyCode](event);
            keyboardHandlers[event.keyCode] = null;
            return false;
        }

        if (keyboardHook && !inTextBox) {
            keyboardHook(event);
        }
    });

    function debug() {
        if (!request.debug) {
            return;
        }

        var $output = $('#debug-output');

        if ($output.length == 0) {
            $output = $('<div id="debug-output">').appendTo(document.body);
        }

        for (var i = 0; i < arguments.length; i++) {
            var $row = $('<div>').appendTo($output);
            $row.css({'border-bottom': '1px solid #ccc'});
            $row.text(JSON.stringify(arguments[i]));
            console.info(arguments[i]);
        }
    }

    function setCookie(name, value) {
        var cookieValue = encodeURIComponent(name) + '=' + encodeURIComponent(value);
        document.cookie = cookieValue;
    }

    function clearCookie(name) {
        var cookieValue = encodeURIComponent(name) + '=' + '; expires=Thu, 01 Jan 1970 00:00:01 GMT';
        document.cookie = cookieValue;
    }
    
    function makeMissionLink($link, delta) {
        $link.removeClass('disabled');
        $link.attr('href', 'javascript:void(0)');

        $link.click(function () {
            var newSessionValue = (currentMission + 1) + delta;

            if (sessionStorage) {
                sessionStorage.setItem('mission', newSessionValue);
            } else {
                setCookie('mission', newSessionValue);
            }
            
            location.href = location.pathname;
        });
    }

    if (!isRanking) {
        $('#banner').attr('class', 'mission-' + (currentMission + 1));
    }

    if (isRanking) {
        var rankingPath = request.example ? 'ranking-example.csv' : 'ranking.csv';
        
        if (langSubdirectory) {
            rankingPath = '../' + rankingPath;
        }

        $.get(rankingPath, {t: new Number(new Date().getTime()).toString(16)}).done(function (data) {
            var rows = data.split(/[\r\n]+/);
            var first = rows[0].split(/,/);

            var date = first[0].split(/\//);
            var num = first[1];
            var suffix = (num ? ' （目標達成：' + num + '名）' : '');
            var formattedDate = date[0] + '月' + date[1] + '日更新';

            if (lang == 'en') {
                var months = [
                    'January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'
                ];

                suffix = (num ? ' (' + num + ' entries)' : '');
                formattedDate = 'Updated: ' + months[date[0] - 1] + ' ' + date[1];
            }

            $('#ranking_board').find('.update').html(formattedDate + suffix);

            var $table = $('#ranking_board').find('.table');
            var $head = $('<tr>').appendTo($table);
            $('<th>').appendTo($head).html('#');
            $('<th>').appendTo($head).html('ID');
            $('<th>').appendTo($head).html(lang == 'en' ? 'Score' : 'スコア');

            $.each(rows.splice(1), function (index, row) {
                if (row == '') {
                    return;
                }

                var chunks = row.split(/,/);
                var num = chunks[0];
                var id = chunks[1];
                var score = formatAmount(parseInt(chunks[2]) * 10000);

                var $row = $('<tr>').appendTo($table);
                $('<td>').appendTo($row).html(num);
                $('<td>').appendTo($row).html(id);
                $('<td>').appendTo($row).html(score);
            });

        }).fail(function () {
            var message = (lang == 'en' ? '' : '<p>ランキングは随時更新予定です。</p><p>ご応募お待ちしています。</p>');
            $('#ranking_board').find('.update').html(message);
        });
    }

    $('#mission-splash').css({
        'visibility': 'visible',
        'opacity'   : '0',
        'position'  : 'relative',
        'left'      : '30px'
    });

    $('#mission-splash').animate({
        'opacity': '1.0',
        'left'   : '0px'
    }, splashDuration);

    var $statement = $('#mission-statement');
    $statement.css({'visibility': 'visible'});

    for (var i = 0; i < missionConfigs.length; i++) {
        var $item = $statement.find('.mission-' + (i + 1));

        if (currentMission == i) {
            $item.show();
        } else {
            $item.hide();
        }
    }

    var missionTitle = 'Mission';

    if (isRanking) {
        missionTitle = 'Ranking';
    } else if (currentMission == 0) {
        missionTitle = 'First Mission';
    } else if (currentMission == 1) {
        missionTitle = 'Second Mission';
    } else if (currentMission == 2) {
        missionTitle = 'Final Mission';
    }

    $('#mission-splash').html(missionTitle);

    $('#var-min-interval').html(typeof minInterval != 'undefined' ? minInterval : '');
    $('#var-max-position').html(typeof maxPosition != 'undefined' ? formatNumber(maxPosition) : '');
    $('#var-commission-rate').html(typeof commissionRate != 'undefined' ? formatPercent(commissionRate) : '');
    $('#var-max-trade-quantity').html(typeof maxTradeQuantity != 'undefined' ? formatNumber(maxTradeQuantity) : '');

    var missionPrefix = (currentMission < missionConfigs.length - 1 ? ('第' + (currentMission + 1)) : '最終');
    var siteURL = 'https://internchallenge.morganstanley.co.jp';
    var tweetURL = 'https://twitter.com/share?url=' + encodeURIComponent(siteURL) + '&' +
        'text=' + encodeURIComponent(
            lang == 'en' ? (missionTitle + ' complete!') : (missionPrefix + 'ミッション突破！')
        ) + '&' +
        'hashtags=' + encodeURIComponent(lang == 'en' ? 'Algorithm Battle' : 'アルゴリズムバトル');

    if (isRanking) {
        // No-op
    } else if (currentMission == 0) {
        if (lang == 'en') {
            popupMessage = '<h1>Mission Completed!</h1>' +
                '<p>Did you get the idea?</p>' +
                '<p>Remember, "buy low, sell high" to increase your profit.</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                '<a href="' + tweetURL + '" target="_blank">' +
                '<span class="icon-twitter"></span> Tweet' +
                '</a>' +
                '</p>' +
                '<p>' +
                '<a class="next-mission btn-capsule enter-key">Next Mission</a>' +
                '</p>' +
                '</div>';
        } else {
            popupMessage = '<h1>目標達成！</h1>' +
                '<p>要領はつかめましたか？</p>' +
                '<p>できるだけ安いときに買い、高いときに売れば、収益を膨らませることができます。</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                '<a href="' + tweetURL + '" target="_blank">' +
                '<span class="icon-twitter"></span> Tweet' +
                '</a>' +
                '</p>' +
                '<p>' +
                '<a class="next-mission btn-capsule enter-key">→次のミッションへ</a>' +
                '</p>' +
                '</div>';
        }

        $('#result-section').hide();

    } else if (currentMission == 1) {
        if (lang == 'en') {
            popupMessage = '<h1>Mission Completed!</h1>' +
                '<p>' +
                'Were you able to maximize return at each interval?' +
                '</p>' +
                '<p>' +
                'The next mission will require more advanced algorithms.' +
                '</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                '<a href="' + tweetURL + '" target="_blank">' +
                '<span class="icon-twitter"></span> Tweet' +
                '</a>' +
                '</p>' +
                '<p>' +
                '<a class="next-mission btn-capsule enter-key">Next Mission</a>' +
                '</p>' +
                '</div>';
        } else {
            popupMessage = '<h1>目標達成！</h1>' +
                '<p>' +
                '同じ時刻ごとに収益率を最大化する銘柄をうまく選べましたか？' +
                '</p>' +
                '<p>' +
                '次は本格的にアルゴリズムを駆使した挑戦になります。' +
                '</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                '<a href="' + tweetURL + '" target="_blank">' +
                '<span class="icon-twitter"></span> Tweet' +
                '</a>' +
                '</p>' +
                '<p>' +
                '<a class="next-mission btn-capsule enter-key">→次のミッションへ</a>' +
                '</p>' +
                '</div>';
        }

        $('#result-section').hide();
        
    } else if (currentMission == 2) {
        if (lang == 'en') {
            popupMessage = '<h1>Mission Completed!</h1>' +
                '<p>' +
                'Morgan Stanley is hiring superior engineers like you.' +
                '</p>' +
                '<p>' +
                'If you want to learn more, apply to the Summer Internship Program to experience financial technology at Morgan Stanley!' +
                '</p>' +
                '<p>' +
                'Click [Result Output] button and paste the output to the application form.' +
                '</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                '<a href="' + tweetURL + '" target="_blank">' +
                '<span class="icon-twitter"></span> Tweet' +
                '</a>' +
                '</p>' +
                '<p>' +
                '<a class="show-result btn-capsule enter-key">Result Output</a>' +
                '</p>' +
                '</div>';
        } else {
            popupMessage = '<h1>目標達成！</h1>' +
                '<p>' +
                'モルガン・スタンレーでは、このようなアルゴリズムを考え抜く力を持ったエンジニアを積極的に採用しています。' +
                '</p>' +
                '<p>' +
                '金融とテクノロジーが生み出す未来の可能性を感じていただけたでしょうか。是非 長期インターンシップ プログラムを通して実務を体験してみてください。' +
                '</p>' +
                '<p>' +
                '長期インターンシップ プログラムに応募する場合は、「解答データ」ボタンをクリックして、エントリーシートの該当欄に貼り付けてください。' +
                '</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                '<a href="' + tweetURL + '" target="_blank">' +
                '<span class="icon-twitter"></span> Tweet' +
                '</a>' +
                '</p>' +
                '<p>' +
                '<a class="show-result btn-capsule enter-key">解答データを出力</a>' +
                '</p>' +
                '</div>';
        }

        $('#result-section').show();
    }

    if (currentMission == 0) {
        $('#previous-mission').addClass('disabled');
    } else {
        makeMissionLink($('#previous-mission'), -1);
    }

    if (currentMission >= missionConfigs.length - 1) {
        $('#next-mission').addClass('disabled');
    } else {
        makeMissionLink($('#next-mission'), +1);
    }

    if (lang == 'en') {
        $('#mission-initial').html(
            '<p>' + 'Initial Balance: <b>' + initialString + '</b>' + '</p>'
        );

        $('#mission-target').html(
            '<p>' + 'Target Balance: <b>' + targetString + '</b>' + '</p>'
        );
    } else {
        $('#mission-initial').html(
            '<p>' + '元本: <b>' + initialString + '</b>' + '</p>'
        );

        $('#mission-target').html(
            '<p>' + '目標：<b>' + targetString + '</b>' + '</p>'
        );
    }

    var predefStockVars = [];

    for (var s = 0; s < numStocks; s++) {
        predefStockVars.push(String.fromCharCode(65 + s) + ' = ' + s);
    }

    $('#pre-defined').html(
        "var " + predefStockVars.join(', ') + "; // Stock ID\n" +
        "var S = " + numStocks + "; // " + (lang == 'en' ? 'Number of Stocks' : "利用可能な銘柄の数") + "\n" +
        "var T = " + endTime + "; // " + (lang == 'en' ? 'Number of Intervals' : "トータルの時間の長さ") + "\n" +
        "\n" +
        "Stock ID range: 0 to (S-1)\n" +
        "Time range: 0 to (T-1)\n"
    );

    function showMobileNav() {
        $('#mobile-nav-close').show();
        $('#mobile-nav-pane').show();
        $('#dark-overlay').show();
        $('body').addClass('mobile-nav-activated');
    }

    function hideMobileNav() {
        $('#mobile-nav-close').hide();
        $('#mobile-nav-pane').hide();
        $('#dark-overlay').hide();
        $('body').removeClass('mobile-nav-activated');
    }

    $('#mobile-nav-open').click(showMobileNav);
    $('#mobile-nav-close').click(hideMobileNav);
    $('#dark-overlay').click(hideMobileNav);

    $('#mobile-nav-pane').find('.parent-menu').each(function () {
        var $li = $(this);
        var $child = $li.children('ul');
        var $arrow = $li.children('.arrow').children('span');
        var $link = $li.children('a');
        $link.attr('href', 'javascript:void(0)');

        var expanded = false;
        $link.click(function () {
            if (expanded) {
                $child.hide();
                $arrow.attr('class', 'icon-down-nav');
            } else {
                $child.show();
                $arrow.attr('class', 'icon-up-nav');
            }
            expanded = !expanded;
            event.preventDefault();
            return false;
        });
    });

    var $window = $(window);
    var $document = $(document);
    var $sharebar = $('#sharebar');
    var $sharebarWrapper = $('#sharebar-wrapper');
    var sharebarLength = $sharebar.width(); // longer side
    var sharebarMargin = $sharebar.height(); // shorter side
    var $header = $('#main-header');
    var $banner = $('#banner');
    var $content = $('#main-body>.content-wrapper');
    var $footer = $('#main-footer');

    function updateSharebarPosition() {
        var innerMax = 160;
        var innerMin = 20;
        var outerMin = 20;

        // outer: left margin of sharebar
        // inner: right margin of sharebar

        if ($sharebarWrapper.length == 0) {
            return;
        }

        var margin = ($document.width() - $content.width()) / 2 - sharebarMargin;
        var outer = margin - innerMax;

        if (outer < outerMin) {
            outer = outerMin;
        }

        var inner = margin - outer;

        if (inner < innerMin) {
            // Not enough window width: Mobile version
            $sharebar.css({
                'position': 'relative',
                'left': 0,
                'top': 0,
                'width': sharebarLength
            });

            return;
        }

        if (inner > innerMax) {
            inner = innerMax;
            outer = margin - inner;
        }

        var scrollTop = $window.scrollTop();
        var visualTop = 135;

        var top = $sharebarWrapper.position().top;
        var bottom = $document.height() - $footer.outerHeight() - sharebarLength;

        if (scrollTop + visualTop < top) {
            $sharebar.css({
                'position': 'absolute',
                'left': outer,
                'top': top,
                'width': sharebarMargin
            });
        } else if (scrollTop + visualTop < bottom) {
            $sharebar.css({
                'position': 'fixed',
                'left': outer,
                'top': visualTop,
                'width': sharebarMargin
            });
        } else {
            $sharebar.css({
                'position': 'absolute',
                'left': outer,
                'top': bottom,
                'width': sharebarMargin
            });
        }
    }

    $window.scroll(updateSharebarPosition);
    $window.resize(updateSharebarPosition);
    updateSharebarPosition();

    $('#help-button').click(function () {
        setEvent('usage');

        var message;

        if (lang == 'en') {
            message = '<h1>Usage</h1>' +
                '<p>Click or tap the chart to buy or sell the stock.</p>' +
                '<p><span class="band-icon white-band-icon"></span> ' +
                  'You can <i>buy</i> the stock in white areas, ' +
                  '<span class="band-icon yellow-band-icon"></span> ' +
                  '<i>sell</i> the stock in yellow areas, ' +
                  'and <i>cancel</i> the trade on borders of areas. ' +
                '</p>' +
                '<p>' +
                  'On a <b>PC</b>, a simple click is enough to perform each action. ' +
                  'Hold Ctrl or Cmd key and click to remove the whole area. ' +
                '</p>' +
                '<p>' +
                  'On a <b>smart phone</b>, tap the chart to select a time ' +
                  'and then tap <span class="buy-button">Buy</span> ' +
                  '<span class="sell-button">Sell</span> ' +
                  '<span class="cancel-button">Cancel</span> ' +
                  'to complete each action. ' +
                '</p>' +
                '<div class="dialog-menu">' +
                '<p><a class="btn-capsule done-button enter-key">Close</a></p>' +
                '</div>';
        } else {
            message = '<h1>操作方法</h1>' +
                '<p>価格チャートをクリックまたはタップをすることで、売買を行うことができます。</p>' +
                '<p><span class="band-icon white-band-icon"></span> ' +
                  '白色の期間では「購入」、' +
                  '<span class="band-icon yellow-band-icon"></span> ' +
                  '黄色の期間では「売却」、' +
                  '境界線上では「取消」の操作となります。' +
                '</p>' +
                '<p>' +
                  '<b>PC</b>の場合、チャートをクリックすることで各操作を行います。' +
                  'CtrlまたはCmdキーを押しながらクリックすると、エリア単位で取消を行うことができます。' +
                '</p>' +
                '<p>' +
                  '<b>スマートフォン</b>の場合、チャートをタップして選択し、' +
                  '下部に表示される <span class="buy-button">買う</span> ' +
                  '<span class="sell-button">売る</span> ' +
                  '<span class="cancel-button">取消</span> ' +
                  'のボタンをクリックすると各操作が完了します。' +
                '</p>' +
                '<div class="dialog-menu">' +
                '<p><a class="btn-capsule done-button enter-key">閉じる</a></p>' +
                '</div>';
        }

        var $dialog = renderDialog(message, 'help-dialog', false);

        var $close = $dialog.find('.close-button');
        var $done = $dialog.find('.done-button');

        $done.click(function () {
            $close.click();
        });
    });

    var scrollWrappers = [];
    var scrollWrapperTimer = null;

    function setupScrollWrappers() {
        $('.scroll-wrapper').each(function () {
            var $wrapper = $(this);
            var $control = $('<div>').insertAfter($wrapper);
            $control.attr('class', 'scroll-control');

            scrollWrappers.push({
                $wrapper: $wrapper,
                $control: $control
            });

            var scrollTimer = null;

            $wrapper.scroll(function () {
                if (!scrollTimer) {
                    scrollTimer = setTimeout(function () {
                        updateScrollWrapper($wrapper, $control);
                        scrollTimer = null;
                    }, 0);
                }
            });

            var $left = $('<div>').appendTo($control);
            $left.attr('class', 'scroll-left button-wrapper');
            $left.html('&lt;');

            var $right = $('<div>').appendTo($control);
            $right.attr('class', 'scroll-right button-wrapper');
            $right.html('&gt;');

            function makeHandler(delta) {
                return function () {
                    var scrollLeft = $wrapper.scrollLeft();
                    var maxScrollLeft = Math.floor($wrapper.prop('scrollWidth') - $wrapper.width());
                    scrollLeft += delta;
                    if (scrollLeft < 0) {
                        scrollLeft = 0;
                    } else if (scrollLeft > maxScrollLeft) {
                        scrollLeft = maxScrollLeft;
                    }
                    $wrapper.stop();
                    $wrapper.animate({scrollLeft: scrollLeft}, 'fast', function () {
                        updateScrollWrapper($wrapper, $control);
                    });
                    clearSelection();
                };
            }
            
            var scrollDelta = $wrapper.width() / 2;
            $left.mousedown(makeHandler(-scrollDelta));
            $right.mousedown(makeHandler(+scrollDelta));
        });

        updateScrollWrappers();
    }

    setTimeout(setupScrollWrappers, 0);

    function updateScrollWrapper($wrapper, $control) {
        var maxScrollLeft = Math.floor($wrapper.prop('scrollWidth') - $wrapper.width());

        if (maxScrollLeft > 0) {
            $control.show();
            var $left = $control.find('.scroll-left');
            var $right = $control.find('.scroll-right');
            var scrollLeft = $wrapper.scrollLeft();

            if (scrollLeft == 0) {
                $left.addClass('disabled');
            } else {
                $left.removeClass('disabled');
            }

            if (scrollLeft >= maxScrollLeft) {
                $right.addClass('disabled');
            } else {
                $right.removeClass('disabled');
            }
        } else {
            $control.hide();
            $wrapper.scrollLeft(0);
        }
    }

    function updateScrollWrappers() {
        for (var i = 0; i < scrollWrappers.length; i++) {
            var $wrapper = scrollWrappers[i].$wrapper;
            var $control = scrollWrappers[i].$control;
            updateScrollWrapper($wrapper, $control);
        }
    }

    $window.resize(function () {
        if (!scrollWrapperTimer) {
            scrollWrapperTimer = setTimeout(function () {
                updateScrollWrappers();
                scrollWrapperTimer = null;
            }, 0);
        }
    });

    $('#reset-button').click(function () {
        setEvent('reset');

        var message;

        if (lang == 'en') {
            message = '<h1>Reset</h1>' +
                '<p>Clear all trades and start over?</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                  '<a class="btn-capsule btn-red reset-button enter-key">Reset</a>' +
                  '&nbsp;&nbsp;' + 
                  '<a class="btn-capsule escape-key">Cancel</a>' +
                '</p>' +
                '</div>';
        } else {
            message = '<h1>全消去</h1>' +
                '<p>全ての売買を取り消して、最初からやり直しますか？</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                  '<a class="btn-capsule btn-red reset-button enter-key">全消去</a>' +
                  '&nbsp;&nbsp;' + 
                  '<a class="btn-capsule escape-key">キャンセル</a>' +
                '</p>' +
                '</div>';
        }

        var $dialog = renderDialog(message, 'reset-dialog', false);
        var $close = $dialog.find('.close-button');

        var $reset = $dialog.find('.reset-button');

        $reset.click(function () {
            reset();
            $close.click();
            showComplete(lang == 'en' ? 'Cleared all trades.' : '全消去しました。');
        });
    });

    var touchEnabled = false;

    $('#charts').bind('touchstart', function () {
        touchEnabled = true;
    });

    $('#charts').bind('touchend', function () {
        clearSelection();
    });

    function swingScroll(targetTop) {
        var windowTop = $(document).height() - $(window).height();
        var scrollTop = Math.max(0, Math.min(targetTop, windowTop));
        var distance = Math.abs(scrollTop - $(window).scrollTop());

        if (distance > 0) {
            var duration = 50 * Math.log(distance);
            $('html, body').stop().animate({scrollTop: scrollTop}, duration, 'swing');
        }
    };

    function editScript() {
        $('#console').show();
        focusScript();

        if (scriptEditor) {
            scriptEditor.refresh();
        }

        swingScroll($('#console').offset().top - 20);
        updateScrollWrappers();
    }

    $('#console-button').click(function () {
        setEvent('console');
        editScript();
    });

    var scriptEditorDisabled = (request.editor && request.editor === '0');

    if (!scriptEditorDisabled && window.CodeMirror) {
        scriptEditor = CodeMirror.fromTextArea(document.getElementById('script'), {
            mode: 'javascript',
            lineNumbers: true,
            keyMap: 'sublime',
            theme: 'devtools',
            autoCloseBrackets: true,
            matchBrackets: true,
            showCursorWhenSelecting: true,
            tabSize: 4,
            indentUnit: 4
        });
    }

    if (typeof request.src != 'undefined') {
        if (request.src != '') {
            $.get({url: request.src, dataType: 'text'}).done(function (data) {
                setScript(data);
                if (lang == 'en') {
                    showInfo('Loaded script: ' + request.src);
                } else {
                    showInfo('スクリプトをロードしました：' + request.src);
                }
                if (request.run) {
                    executeScript();
                }
            }).fail(function (xhr, status, error) {
                showError(error + ': ' + request.src);
            });
        }
    }

    function focusScript() {
        if (scriptEditor) {
            scriptEditor.focus();
        } else {
            $('#script').focus();
        }
    }

    function blurScript() {
        if (scriptEditor) {
            scriptEditor.getInputField().blur();
        } else {
            $('#script').blur();
        }
    }

    function setScript(value) {
        autoSaveScript(true);
        
        if (scriptEditor) {
            scriptEditor.setValue(value);
        } else {
            $('#script').val(value);
        }
    }

    function getScript() {
        if (scriptEditor) {
            return scriptEditor.getValue();
        } else {
            return $('#script').val();
        }
    }

    function getExampleScript() {
        return $('#example-script').text().replace(/^\s+|\s+$/g, '') + "\n";
    }

    function onScriptChange(handler) {
        if (scriptEditor) {
            scriptEditor.on('change', handler);
        } else {
            $('#script').bind('input propertychange', handler);
        }
    }

    function onScriptBlur(handler) {
        if (scriptEditor) {
            scriptEditor.on('blur', handler);
        } else {
            $('#script').blur(handler);
        }
    }

    var autoSave = null;
    var autoSaveTimer = null;

    function autoSaveScript(revCut) {
        if (!localStorage) {
            return;
        }

        var text = getScript();
        var now = new Date().getTime();

        var empty = !text.match(/\S/);
        var changed = (!autoSave || autoSave.text != text);
        var idle = (!autoSave || autoSave.mtime < now - 10 * 60 * 1000);

        if (autoSave && idle) {
            autoSave.rev = null; // create a new revision now
        }

        if (!empty && changed) {
            if (!autoSave) {
                autoSave = {};
            }

            if (!autoSave.rev) {
                autoSave.rev = parseInt(localStorage['autosave-rev']) || 0;
                autoSave.rev++;
                localStorage['autosave-rev'] = autoSave.rev;
            }

            autoSave.text = text;
            autoSave.mtime = now;

            localStorage['autosave-' + autoSave.rev + '-text'] = text;
            localStorage['autosave-' + autoSave.rev + '-size'] = text.length;
            localStorage['autosave-' + autoSave.rev + '-mtime'] = now;
            localStorage['autosave-' + autoSave.rev + '-mission'] = currentMission + 1;

            cleanAutoSave();

            $('#restore-button').show();
        }

        if (autoSave && revCut) {
            autoSave.rev = null; // create a new revision next time
        }
    }

    function cleanAutoSave(deleteAll) {
        if (!localStorage) {
            return;
        }

        var keep = 5;

        for (var key in localStorage) {
            if (key.match(/^autosave-(\d+)-/)) {
                var rev = parseInt(RegExp.$1);

                if (deleteAll || rev <= autoSave.rev - keep) {
                    localStorage.removeItem(key);
                }
            }
        }

        if (deleteAll) {
            localStorage.removeItem('autosave-rev');
            $('#restore-button').hide();
        }
    }

    function restoreAutoSave(rev) {
        if (!localStorage) {
            return;
        }

        var text = localStorage['autosave-' + rev + '-text'];
        var mtime = parseInt(localStorage['autosave-' + rev + '-mtime']);

        autoSaveScript(true);

        if (!autoSave) {
            autoSave = {};
        }

        autoSave.rev = null; // create a new revision next time
        autoSave.text = text;
        autoSave.mtime = mtime;

        setScript(text);
        showInfo(lang == 'en' ? 'Restored script.' : 'スクリプトを復元しました。');
    }

    onScriptChange(function () {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }

        autoSaveTimer = setTimeout(function () {
            autoSaveTimer = null;
            autoSaveScript();
        }, 500);
    });

    $(window).bind('onbeforeunload', function () {
        autoSaveScript(true);
    });

    if (localStorage && localStorage['autosave-rev']) {
        $('#restore-button').show();
    }

    $('#restore-button').click(function () {
        setEvent('autosave');

        if (!localStorage) {
            showError(lang == 'en' ? 'Auto-save is not supported.' : 'お使いのブラウザでは自動保存はサポートされていません。');
            return;
        }

        var entries = [];

        for (var key in localStorage) {
            if (key.match(/^autosave-(\d+)-size$/)) {
                var rev = parseInt(RegExp.$1);
                entries.push({
                    rev: rev,
                    size: parseInt(localStorage['autosave-' + rev + '-size']),
                    mtime: parseInt(localStorage['autosave-' + rev + '-mtime']),
                    mission: parseInt(localStorage['autosave-' + rev + '-mission'])
                });
            }
        }

        entries.sort(function (a, b) {
            return b.mtime - a.mtime;
        });

        var keep = 5;

        if (entries.length > keep) {
            entries = entries.slice(0, keep);
        }

        var dow = lang == 'en' ?
            ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] :
            ['日', '月', '火', '水', '木', '金', '土'];

        var chunks = ['<h1>' + (lang == 'en' ? 'Restore' : '自動保存から復元') + '</h1>'];
        chunks.push('<table>');

        for (var e = 0; e < entries.length; e++) {
            var entry = entries[e];
            var date = new Date(entry.mtime);

            var fmtDate =
                '<nobr>' + formatDate(date.getMonth() + 1, date.getDay()) + '</nobr>' +
                '<nobr>' +
                    (lang == 'en' ? ' (' + dow[date.getDay()] + ') ' : '（' + dow[date.getDay()] + '）') +
                '</nobr>' +
                '<nobr>' + formatTime(date.getHours(), date.getMinutes()) + '</nobr>';
            
            var fmtSize =
                '<nobr>［' + entry.size +
                    (lang == 'en' ? ' byte' + (entry.size == 1 ? '' : 's') : '文字') +
                '］</nobr>';

            var id = 'restore-rev-' + entry.rev;
            var restoreButton =
                '<nobr><a class="buy-button restore-link" id="' + id + '">' +
                    (lang == 'en' ? 'Restore' : '復元') +
                '</a></nobr>';

            chunks.push('<tr>');
            chunks.push('<td>' + fmtDate + ' ' + fmtSize + '</td>');
            chunks.push('<td>&nbsp;' + restoreButton + '</td>');
            chunks.push('</tr>');
        }

        chunks.push('</table>');
        chunks.push('<br>');

        chunks.push('<div>');

        if (entries.length > 0) {
            chunks.push('<a class="btn-capsule clean-autosave-button">' +
                (lang == 'en' ? 'Clear History' : '履歴を消去') +
            '</a>');

            chunks.push('&nbsp;&nbsp;');
        }

        chunks.push(
            '<a class="btn-capsule escape-button">' +
                (lang == 'en' ? 'Cancel' : 'キャンセル') +
            '</a>'
        );

        chunks.push('</div>');

        var $dialog = renderDialog(chunks.join(''), 'help-dialog');
        var $close = $dialog.find('.close-button');

        $dialog.find('.restore-link').each(function () {
            var $restore = $(this);
            var id = $restore.attr('id');
            id.match(/^restore-rev-(\d+)$/);
            var rev = parseInt(RegExp.$1);

            $restore.click(function () {
                restoreAutoSave(rev);
                $close.click();
            });
        });

        $dialog.find('.clean-autosave-button').click(function () {
            var message;

            if (lang == 'en') {
                message = '<h1>Clear auto-save history</h1>' +
                    '<p>Auto-save history is saved on the local PC.</p>' +
                    '<p>Are you sure to clear the history?</p>' +
                    '<div>' +
                    '<a class="btn-capsule btn-red enter-key">Clear</a>' +
                    '&nbsp;&nbsp;' +
                    '<a class="btn-capsule escape-key">Cancel</a>' +
                    '</div>';
            } else {
                message = '<h1>自動保存履歴の全消去</h1>' +
                    '<p>自動保存の履歴は、ローカルPC上に保存されています。</p>' +
                    '<p>全消去しますか？</p>' +
                    '<div>' +
                    '<a class="btn-capsule btn-red enter-key">全消去</a>' +
                    '&nbsp;&nbsp;' +
                    '<a class="btn-capsule escape-key">キャンセル</a>' +
                    '</div>';
            }

            var $subDialog = renderDialog(message, 'help-dialog');

            $subDialog.find('.enter-key').click(function () {
                cleanAutoSave(true);
                showComplete(lang == 'en' ? 'Cleared auto-save history.' : '自動保存の履歴を消去しました。');
                $subDialog.find('.close-button').click();
            });
        });

        var $escape = $dialog.find('.escape-button');

        $escape.click(function() {
            $close.click();
        });
    });

    function downloadCSV(fileName, content) {
        $('#hidden-csv').remove();
        var link = document.createElement("a");
        link.setAttribute("id", "hidden-csv");
        link.setAttribute("href", encodeURI(content));
        link.setAttribute("download", fileName);
        document.body.appendChild(link);
        link.click();
    }

    $('#data-csv').click(function () {
        setEvent('csv');
        var chunks = ["data:text/csv;charset=utf-8,"];
        chunks.push("Time");
        for (var s = 0; s < numStocks; s++) {
            chunks.push("," + stockLabels[s]);
        }
        chunks.push("\r\n");
        for (var t = 0; t < endTime; t++) {
            chunks.push(t);
            for (var s = 0; s < numStocks; s++) {
                chunks.push("," + quotes[s][t]);
            }
            chunks.push("\r\n");
        }
        var content = chunks.join('');
        downloadCSV("prices.csv", content);
    });

    function getHashCode(str) {
        var code = 0;
        if (str.length == 0) {
            return code;
        }
        for (var i = 0; i < str.length; i++) {
            var ch = str.charCodeAt(i);
            code = ((code << 5) - code) + ch;
            code &= code;
        }
        return code;
    }

    $('#result-button').click(function (event) {
        setEvent('result');
        var chunks = [];
        chunks.push(loadTime.toString(16).toUpperCase());
        chunks.push(':');
        chunks.push(currentSeed.toString(16).toUpperCase());
        var anyTrades = false;
        for (var t = 0; t < endTime; t++) {
            if (tradeTable[t]) {
                for (var i = 0; i < tradeTable[t].length; i++) {
                    var trade = tradeTable[t][i];
                    chunks.push(':');
                    chunks.push(trade.time);
                    chunks.push(trade.side == BUY ? "B" : "S");
                    chunks.push(shortStockLabels[trade.stock]);
                    if (typeof trade.quantity != 'undefined') {
                        chunks.push(trade.quantity);
                    }
                    anyTrades = true;
                }
            }
        }
        var fragment = chunks.join('');
        var generatedID = Math.abs(getHashCode(fragment)).toString(16).toUpperCase();
        if (!anyTrades && !(event.ctrlKey || event.metaKey)) {
            showError(lang == 'en' ? 'Please buy or sell stocks first.' : '売買を行ってから出力してください。');
        } else {
            $('#result-data').html(generatedID + ':' + fragment);
            $('#result-id').html(generatedID);
            $('#result-output').show();
            swingScroll($('#result-output').offset().top - 20);
        }
    });

    var $resultData = $('#result-data');

    $resultData.focus(function () {
        $(this).select();
    });

    if (window.ClipboardJS) {
        (function () {
            var clipboard = new ClipboardJS('#result-clipboard-button', {
                text: function () {
                    return $resultData.val();
                }
            });

            clipboard.on('success', function () {
                showInfo(lang == 'en' ? 'Copied result output to Clipboard' : '解答データをクリップボードにコピーしました。');

                $resultData.css({'background-color': '#lightyellow'});

                setTimeout(function () {
                    $resultData.css({'background-color': ''});
                }, 4000);
            });
        })();
    }

    $('#custom-seed-button').click(function (event) {
        setEvent('seed');
        updateCustomSeed();
    });

    $('#custom-seed-input').keydown(function (event) {
        if (event.keyCode == ENTER_KEY) {
            setEvent('seed');
            updateCustomSeed();
        }
    });

    var BUY = 0, SELL = 1;
    var initialBalance = 10000;




    var stockLabels = ['Stock A', 'Stock B', 'Stock C'];
    var shortStockLabels = ['A', 'B', 'C'];

    var $firstTr;

    var plotBandColor = '#ffb';
    var errorBandColor = '#fee';
    var emptyBandColor = '#fff';

    function formatInvalidInput(value) {
        if (value === undefined) {
            return 'undefined';
        } else if (value === null) {
            return 'null';
        } else {
            return JSON.stringify(value);
        }
    }

    function normalizeInt(value, required) {
        if (!required && value === undefined) {
            return 0;
        }
        try {
            var num = parseInt(value);
            if (isNaN(num)) {
                throw 'Failed to parse int';
            }
            return num;
        } catch (e) {
            throw (lang == 'en' ? 'Invalid integer' : '無効な整数値') + ': ' + formatInvalidInput(value);
        }
    }

    function validateInt(value, required) {
        if (!required && value === undefined) {
            return;
        }
        if (value !== normalizeInt(value)) {
            throw (lang == 'en' ? 'Invalid integer' : '無効な整数値') + ': ' + formatInvalidInput(value);
        }
    }

    function validateType(value, required, type, defaultValue) {
        if (!required && value === undefined) {
            return defaultValue;
        }
        if (typeof value != type) {
            throw (lang == 'en' ? 'Invalid parameter' : '無効なパラメータ') + '： ' + formatInvalidInput(value);
        }
        return value;
    }

    function validateNumber(value, required) {
        return validateType(value, required, 'number', 0);
    }

    function validateString(value, required) {
        return validateType(value, required, 'string', '');
    }

    function validateObject(value, required) {
        return validateType(value, required, 'object', null);
    }

    function validateStock(value, required) {
        if (!required && value === undefined) {
            return;
        }
        validateInt(value, required);
        if (value < 0 || value >= numStocks) {
            throw (lang == 'en' ? 'Invalid' : '無効な') + ' Stock ID: ' + formatInvalidInput(value);
        }
    }

    function validateQuote(value, required) {
        if (!required && value === undefined) {
            return;
        }
        validateInt(value, required);
        if (value < 0 || value >= numStocks + 1) {
            throw (lang == 'en' ? 'Invalid' : '無効な') + ' Stock ID: ' + formatInvalidInput(value);
        }
        return value;
    }

    function validateTime(value, required) {
        if (!required && value === undefined) {
            return;
        }
        validateInt(value, required);
        if (value < 0 || value >= endTime) {
            throw (lang == 'en' ? 'Invalid time' : '無効な時間') + ': ' + formatInvalidInput(value);
        }
        return value;
    }

    function validateSide(value, required) {
        if (!required && value === undefined) {
            return;
        }
        validateInt(value, required);
        if (!(value == BUY || value == SELL)) {
            throw (lang == 'en' ? 'Invalid trade' : '無効な売買') + ': ' + formatInvalidInput(value);
        }
        return value;
    }

    function validateSize(value, required) {
        if (!required && value === undefined) {
            return;
        }
        validateInt(value, required);
        if (value < 0) {
            throw (lang == 'en' ? 'Invalid quantity' : '無効な数量') + ': ' + formatInvalidInput(value);
        }
        return value;
    }

    function validateTradeID(value, required) {
        if (!required && value === undefined) {
            return;
        }
        validateInt(value, required);
        if (value < 0 || value >= tradeList.length) {
            throw (lang == 'en' ? 'Invalid' : '無効な') + ' Trade ID: ' + formatInvalidInput(value);
        }
        if (tradeList[value] === null) {
            throw (lang == 'en' ? 'Canceled trade' : '取消済みのトレード') + ': ' + formatInvalidInput(value);
        }
        return value;
    }

    function validateMission(value, required) {
        if (!required && value === undefined) {
            return;
        }

        validateInt(value, required);

        if (value < 1 || value > missionConfigs.length) {
            throw (lang == 'en' ? 'Invalid mission' : '無効なミッション') + ': ' + formatInvalidInput(value);
        }

        return value;
    }

    /*API*/
    function buy(stock, time, quantity) {
        validateStock(stock, true);
        validateTime(time, true);
        validateSize(quantity, false);
        return new Trade(addTrade(stock, time, BUY, quantity));
    }

    /*API*/
    function sell(stock, time, quantity) {
        validateStock(stock, true);
        validateTime(time, true);
        validateSize(quantity, false);
        return new Trade(addTrade(stock, time, SELL, quantity));
    }

    function buyManual(stock, time, quantity) {
        if (tradeList.length < maxManualTrades) {
            setEvent('trade');
            return addTrade(stock, time, BUY, quantity, true);
        } else {
            showError(lang == 'en' ? 'Exceeded max allowed number of manual trades.' : '手作業で売買できる取引回数を超えました。');
        }
    }

    function sellManual(stock, time, quantity) {
        if (tradeList.length < maxManualTrades) {
            setEvent('trade');
            return addTrade(stock, time, SELL, quantity, true);
        } else {
            showError(lang == 'en' ? 'Exceeded max allowed number of manual trades.' : '手作業で売買できる取引回数を超えました。');
        }
    }

    /*API*/
    function quote(stock, time) {
        validateQuote(stock, true);
        validateTime(time, true);
        return quotes[stock][time];
    }

    /*API*/
    function reset(seedInput) {
        if (typeof seedInput != 'undefined') {
            validateInt(seedInput, true);
            currentSeed = seedInput;
            setup(currentOverride);
        } else {
            for (var t = 0; t < endTime; t++) {
                if (tradeTable[t]) {
                    for (var i = 0; i < tradeTable[t].length; i++) {
                        var trade = tradeTable[t][i];

                        if (trade.$tr) {
                            trade.$tr.remove();
                        }
                    }
                }
            }

            tradeTable = [];
            tradeList = [];
            plotBandRanges = [];

            for (var s = 0; s < numStocks; s++) {
                plotBandRanges[s] = [];
            }

            setCalculateTime(0);
        }
    }

    /*API*/
    function getPosition(stock, time) {
        validateStock(stock, true);
        validateTime(time, true);
        calculateTrades(time);
        var trade = getLastTrade(time);
        return trade ? trade.result.positions[stock] : 0;
    }

    /*API*/
    function getBalance(time) {
        validateTime(time, true);
        calculateTrades(time);
        var trade = getLastTrade(time);
        return trade ? trade.result.balance : initialBalance;
    }

    /*API*/
    function getTotalPV(time) {
        validateTime(time, true);
        calculateTrades(time);
        var trade = getLastTrade(time);
        var totalPV = trade ? trade.result.balance : initialBalance;

        for (var s = 0; s < numStocks; s++) {
            var quantity = trade ? trade.result.positions[s] : 0;
            totalPV += quantity * quotes[s][time];
        }

        return totalPV;
    }

    /*API*/
    function getScore() {
        calculateTrades(endTime - 1);
        var trade = getLastTrade(endTime - 1);
        return trade ? trade.result.totalPV : initialBalance;
    }

    function seed(s) {
        var m_w  = s;
        var m_z  = 987654321;
        var mask = 0xffffffff;

        return function() {
            m_z = (36969 * (m_z & 65535) + (m_z >> 16)) & mask;
            m_w = (18000 * (m_w & 65535) + (m_w >> 16)) & mask;

            var result = ((m_z << 16) + m_w) & mask;
            result /= 4294967296;
            result += 0.5;

            if (result >= 1.0) {
                result -= 1.0;
            }

            return result;
        };
    }

    function norminv(p) {
        var a1 = -39.6968302866538, a2 = 220.946098424521, a3 = -275.928510446969;
        var a4 = 138.357751867269, a5 = -30.6647980661472, a6 = 2.50662827745924;
        var b1 = -54.4760987982241, b2 = 161.585836858041, b3 = -155.698979859887;
        var b4 = 66.8013118877197, b5 = -13.2806815528857;
        var c1 = -7.78489400243029E-03, c2 = -0.322396458041136, c3 = -2.40075827716184;
        var c4 = -2.54973253934373, c5 = 4.37466414146497, c6 = 2.93816398269878;
        var d1 = 7.78469570904146E-03, d2 = 0.32246712907004, d3 = 2.445134137143;
        var d4 = 3.75440866190742;
        var p_low = 0.02425, p_high = 1 - p_low;
        var q, r;
        var retVal;

        if ((p < 0) || (p > 1)) {
            retVal = 0;
        } else if (p < p_low) {
            q = Math.sqrt(-2 * Math.log(p));
            retVal = (((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
        } else if (p <= p_high) {
            q = p - 0.5;
            r = q * q;
            retVal = (((((a1 * r + a2) * r + a3) * r + a4) * r + a5) * r + a6) * q / (((((b1 * r + b2) * r + b3) * r + b4) * r + b5) * r + 1);
        } else {
            q = Math.sqrt(-2 * Math.log(1 - p));
            retVal = -(((((c1 * q + c2) * q + c3) * q + c4) * q + c5) * q + c6) / ((((d1 * q + d2) * q + d3) * q + d4) * q + 1);
        }

        return retVal;
    }

    var themeColors = [
        '#4f9ce5',
        '#3cc81c',
        '#e7934c'
    ];

    // Apply the theme
    Highcharts.setOptions({
        chart: {
            backgroundColor: null
        },
        tooltip: {
            borderWidth: 0,
            backgroundColor: 'rgba(219,219,216,0.8)',
            shadow: false
        },
        legend: {
            itemStyle: {
                fontWeight: 'bold',
                fontSize: '13px'
            }
        },
        xAxis: {
            gridLineWidth: 1,
            minorTickInterval: 'auto'
        },
        yAxis: {
            minorTickInterval: 'auto'
        },
        plotOptions: {
            candlestick: {
                lineColor: '#404048'
            },
            series: {
                turboThreshold: 0
            }
        },
        background2: '#F0F0EA'
    });

    // Prepare series
    function createSeries(columns, colorIndex) {
        var series = [];

        for (var c = 0; c < columns.length; c++) {
            var color = themeColors[colorIndex];
            var color1 = Highcharts.Color(color).setOpacity(0.5).get('rgba');
            var color2 = Highcharts.Color(color).setOpacity(0).get('rgba');

            var column = columns[c];

            column.fillColor = {
                stops: [
                   [0, color2],
                   [1, color1]
                ]
            };

            series.push(column);
        }

        Highcharts.setOptions({
            colors: [themeColors[colorIndex]]
        });

        return series;
    }

    // Draw chart
    function drawChart(elementID, series, stock) {
        var menuTime;

        var $menu = $('#action-menu-' + stock);
        var $buttons = $menu.find('.button-wrapper');

        $buttons.mousedown(function () {
            triggerActionMenu(stock, menuTime);
            startHidingActionMenu(stock);
            touchEnabled = false;
        });

        $buttons.mouseover(function () {
            stopHidingActionMenu(stock);
        });

        $buttons.mouseout(function () {
            startHidingActionMenu(stock);
        });

        function getTime(event) {
            if (event.point) {
                return event.point.x;
            } else if (event.xAxis) {
                var time = Math.round(event.xAxis[0].value);

                if (time < 0) {
                    return 0;
                } else if (time >= endTime) {
                    return endTime - 1;
                } else {
                    return time;
                }
            } else if (event.target) {
                return event.target.x;
            }

            return -1;
        }

        var clickHandler = function (event) {
            var time = getTime(event);

            if (time >= 0) {
                if (event.ctrlKey || event.metaKey) {
                    clearPlotBand(stock, time);
                } else if (!touchEnabled) {
                    togglePosition(stock, time);
                }
            }

            touchEnabled = false;
        };

        var mouseOverHandler = function (event) {
            var time = getTime(event);

            if (time >= 0) {
                menuTime = time;
                showActionMenu(stock, time);
                showChartError(stock, time);
            }
        };

        var mouseOutHandler = function (event) {
            startHidingActionMenu(stock);
            clearSelection();
            hideAlertPopup(500, true);
        };

        var options = {
            chart: {
                type: 'area',
                events: {
                    click: function (event) {
                        clickHandler(event);
                    }
                }
            },
            title: {
                text: null
            },
            exporting: {
                enabled: false
            },
            credits: {
                enabled: false
            },
            legend: {
                floating: true,
                align: 'left',
                verticalAlign: 'top',
                itemStyle: {
                    cursor: 'default'
                }
            },
            plotOptions: {
                area: {
                    marker: {
                        enabled: false,
                        symbol: 'circle',
                        radius: 1,
                        states: {
                            hover: {
                                enabled: true
                            }
                        }
                    },
                    fillColor: {
                        linearGradient: {
                            x1: 0,
                            y1: 1,
                            x2: 0,
                            y2: 0
                        }
                    },
                    threshold: 0,
                    events: {
                        legendItemClick: function () {
                            return false;
                        }
                    }
                },
                series: {
                    events: {
                        click: function (event) {
                            clickHandler(event);
                        }
                    },
                    point: {
                        events: {
                            click: function (event) {
                                // clickHandler(event);
                            },
                            mouseOver: function (event) {
                                mouseOverHandler(event);
                            },
                            mouseOut: function (event) {
                                mouseOutHandler(event);
                            }
                        }
                    }
                }
            },
            xAxis: {
                labels: {
                    enabled: false
                },
                plotBands: [],
                tickWidth: 0
            },
            yAxis: {
                title: {
                    text: null
                },
                labels: {
                    enabled: false
                },
                tickWidth: 0
            },
            tooltip: {
                formatter: function () {
                    var time = this.x;
                    var price = this.y;
                    var actions = [];
                    var withinMinInterval = false;

                    if (tradeTable[time]) {
                        for (var i = 0; i < tradeTable[time].length; i++) {
                            var trade = tradeTable[time][i];

                            if (trade.stock == stock) {
                                var action = '';

                                if (lang != 'en' && trade.result.quantity > 0) {
                                    action += trade.result.quantity + '株';
                                }

                                if (trade.side == BUY) {
                                    action += (lang == 'en' ?
                                        (trade.result.error != '' ? 'Purchasing ' : 'Purchased ') :
                                        '購入'
                                    );
                                } else if (trade.side == SELL) {
                                    action += (lang == 'en' ?
                                        (trade.result.error != '' ? 'Selling ' : 'Sold ') :
                                        '売却'
                                    );
                                }

                                if (lang == 'en') {
                                    action += trade.result.quantity + ' shares';
                                }

                                if (trade.result.error != '') {
                                    action = '<span style="color: red">' +
                                        (lang == 'en' ? 'Error: ' + action : action + 'エラー') +
                                    '</span>';
                                }

                                actions.push(action);
                            }
                        }
                    } else if (minInterval) {
                        var lastTrade = getLastTrade(time, false, minInterval);

                        if (lastTrade) {
                            var interval = time - lastTrade.result.lastBuyTimes[stock];

                            if (interval > 0 && interval < minInterval) {
                                var action = '<span style="color: red">' +
                                    (lang == 'en' ?
                                        minInterval + ' internvals' :
                                        minInterval + '期間制限'
                                    ) +
                                '</span>';
                                actions.push(action);
                            }
                        }
                    }

                    var suffix = actions.join(lang == 'en' ? ' / ' : '／');

                    if (suffix != '') {
                        suffix = '（' + suffix + '）';
                    }

                    return '［' + (lang == 'en' ? 'Time ' + time : '時刻' + time) + '］<br>' +
                        '<span style="color: ' + this.point.color + '">\u25CF</span> ' +
                        this.series.name + ': ' +
                        '<b>' + (lang == 'en' ? 'JPY ' + price : price + '円') + '</b>' + suffix;
                }
            },
            series: series
        };

        var xDate = false;
        var yDate = false;

        for (var s = 0; s < series.length; s++) {
            var column = series[s].data;

            for (var c = 0; c < column.length; c++) {
                var datum = column[c];

                if (typeof datum == 'object') {
                    if (datum.x instanceof Date) {
                        xDate = true;
                    }

                    if (datum.y instanceof Date) {
                        yDate = true;
                    }
                } else {
                    if (datum instanceof Date) {
                        yDate = true;
                    }
                }
            }
        }

        if (xDate) {
            options.xAxis.type = 'datetime';
        }

        if (yDate) {
            options.yAxis.type = 'datetime';
        }

        return Highcharts.chart(elementID, options);
    }

    /*API*/
    function setMission(mission) {
        validateMission(mission, true);
        
        if (sessionStorage) {
            sessionStorage.setItem('mission', mission);
        } else {
            setCookie('mission', mission);
        }
        
        location.href = location.pathname;
    }

    var analyticsEvents = {};

    function setEvent(action, label, value) {
        var params = {
            event_category: 'mission-' + (currentMission + 1),
        };

        if (label) {
            params.event_label = label;
        }

        if (value) {
            params.value = value;
        } else {
            if (!analyticsEvents[action]) {
                analyticsEvents[action] = {};
            }

            if (!label) {
                label = '';
            }

            if (analyticsEvents[action][label]) {
                return;
            } else {
                analyticsEvents[action][label] = true;
            }
        }

        gtag('event', action, params);
    }

    if (!isRanking) {
        setup();
        setEvent('start');
    }

    function renderComponents() {
        // Render initial score
        setScore(initialBalance);

        // Draw charts
        charts = [];
        var $charts = $('#charts');
        $charts.html('');

        for (var s = 0; s < numStocks; s++) {
            (function (stock) {
                var $chart = $('<div id="chart-' + stock + '" class="chart"></div>').appendTo($charts);
                var $menu = $('<div id="action-menu-' + stock + '" class="action-menu"></div>').appendTo($charts);

                function makeButton(className, html) {
                    var $wrapper = $('<div></div>').appendTo($menu);
                    $wrapper.addClass('button-wrapper');

                    var $button = $('<nobr></nobr>').appendTo($wrapper);
                    $button.addClass(className);
                    $button.html(html);
                }

                makeButton('buy-button', (lang == 'en' ? 'Buy' : '買う'));
                makeButton('sell-button', (lang == 'en' ? 'Sell' : '売る'));
                makeButton('cancel-button', (lang == 'en' ? 'Cancel' : '× 取消'));

                charts[stock] = drawChart(
                    'chart-' + stock,
                    createSeries([{
                        name: stockLabels[stock],
                        data: quotes[stock]
                    }], stock),
                    stock
                );

                charts[s].xAxis[0].update({
                    plotBands: []
                });
            })(s);
        }

        // Initialize trade table
        $('#trade-table').html('');

        // Render table heading
        var $headerTr = $('<tr>');

        $headerTr.append('<th>' + (lang == 'en' ? 'Time'    : '時間') + '</th>');
        $headerTr.append('<th>' + (lang == 'en' ? 'Trade'   : '取引') + '</th>');
        $headerTr.append('<th>' + (lang == 'en' ? 'Stock'   : '銘柄') + '</th>');
        $headerTr.append('<th>' + (lang == 'en' ? 'Price'   : '価格') + '</th>');
        $headerTr.append('<th>' + (lang == 'en' ? 'Quantity': '数量') + '</th>');

        $headerTr.append('<th>' + (lang == 'en' ? 'Commission': '手数料') + '</th>');
        $headerTr.append('<th>' + (lang == 'en' ? 'Change'    : '収支') + '</th>');
        $headerTr.append('<th>' + (lang == 'en' ? 'Balance'   : '現金残高') + '</th>');

        for (var s = 0; s < numStocks; s++) {
            var title = stockLabels[s] + (lang == 'en' ? ' Position' : 'の保有数（ポジション）');
            $headerTr.append(
                '<th title="' + title + '">' +
                    shortStockLabels[s] + (lang == 'en' ? ' Position' : '保有数') +
                '</th>'
            );
        }

        $headerTr.append('<th>' + (lang == 'en' ? 'Total PV' : '資産総額') + '</th>');

        $('#trade-table').append($headerTr);

        // Render first row
        $firstTr = $('<tr>');

        $firstTr.append('<td class="time">-</td>');
        $firstTr.append('<td class="side">Start</td>');
        $firstTr.append('<td class="stock">-</td>');
        $firstTr.append('<td class="price">-</td>');
        $firstTr.append('<td class="quantity">-</td>');

        $firstTr.append('<td class="commission">-</td>');
        $firstTr.append('<td class="change">+' + initialBalance + '</td>');
        $firstTr.append('<td class="balance">' + initialBalance + '</td>');

        for (var s = 0; s < numStocks; s++) {
            $firstTr.append('<td class="position">0</td>');
        }

        $firstTr.append('<td class="totalPV">' + initialBalance + '</td>');

        $('#trade-table').append($firstTr);

        // Update scroll wrappers for charts and table
        updateScrollWrappers();
    }

    function clearSelection() {
        if (document.getSelection) {
            document.getSelection().removeAllRanges();
        } else if (window.getSelection) {
            if (window.getSelection().removeAllRanges) {
                window.getSelection().removeAllRanges();
            } else if (window.getSelection().empty) {
                window.getSelection().empty();
            }
        } else if (document.selection) {
            document.selection.empty();
        }
    }

    function updateCustomSeed() {
        var inputValue = $('#custom-seed-input').val().replace(/^\s+|\s+$/g, '');

        try {
            var newSeed = normalizeInt(inputValue, true);
            currentSeed = newSeed;
            setup();

            if (lang == 'en') {
                showInfo('Random seed set to ' + currentSeed);
            } else {
                showInfo('乱数シードを' + currentSeed + 'に設定しました。');
            }
            $('#custom-seed-input').blur();
            window.scrollTo(0, $('#scroll-anchor').offset().top - 10);
        } catch (e) {
            showError(e);
        }
    }

    function getLastTrade(time, withTr, maxLookbackTime) {
        var minTime = 0;
        if (maxLookbackTime) {
            minTime = Math.max(0, time - maxLookbackTime);
        }
        for (var t = time; t >= minTime; t--) {
            if (tradeTable[t]) {
                if (withTr) {
                    for (var i = tradeTable[t].length - 1; i >= 0; i--) {
                        var trade = tradeTable[t][i];

                        if (trade.$tr) {
                            return trade;
                        }
                    }
                } else {
                    return tradeTable[t][tradeTable[t].length - 1];
                }
            }
        }

        return null;
    }

    function getPlotBandRange(stock, time) {
        for (var b = 0; b < plotBandRanges[stock].length; b++) {
            if (plotBandRanges[stock][b].from <= time && time <= plotBandRanges[stock][b].to) {
                return plotBandRanges[stock][b];
            } else if (time < plotBandRanges[stock][b].to) {
                return null;
            }
        }

        return null;
    }

    function addTrade(stock, time, side, quantity, manual) {
        setCalculateTime(time);

        if (!tradeTable[time]) {
            tradeTable[time] = [];
        }

        var trade = {
            id: tradeList.length,
            time: time,
            side: side,
            stock: stock,
            quantity: quantity,
            result: null,
            $tr: null
        };

        tradeList.push(trade);
        tradeTable[time].push(trade);

        if (manual) {
            // Sell action first
            tradeTable[time].sort(function (a, b) {
                if (a.side < b.side) {
                    return 1;
                } else {
                    return -1;
                }
            });

            lastManualTrade = {
                time: time,
                side: side,
                stock: stock,
                quantity: quantity
            };
        }

        return trade;
    }

    function togglePosition(stock, time) {
        var bandRange = getPlotBandRange(stock, time);

        if (bandRange) {
            if (bandRange.from == time || bandRange.to == time) {
                cancelManual(stock, time);
            } else if (bandRange.empty) {
                buyManual(stock, time);
            } else {
                sellManual(stock, time);
            }
        } else {
            buyManual(stock, time);
        }
    }

    var actionMenuTimers = [];

    function showActionMenu(stock, time) {
        stopHidingActionMenu(stock);

        var $menu = $('#action-menu-' + stock);
        $menu.children().hide();
        var $button;

        var bandRange = getPlotBandRange(stock, time);

        if (bandRange) {
            if (bandRange.from == time || bandRange.to == time) {
                $button = $menu.find('.cancel-button');
            } else if (bandRange.empty) {
                $button = $menu.find('.buy-button');
            } else {
                $button = $menu.find('.sell-button');
            }
        } else {
            $button = $menu.find('.buy-button');
        }

        var $wrapper = $button.closest('.button-wrapper');

        var padding = 6;
        var left = charts[stock].series[0].data[time].plotX - $wrapper.width() / 2 + padding;
        var maxLeft = $('#chart-' + stock).width() - $wrapper.width() - padding;

        if (left < 0) {
            left = 0;
        } else if (left > maxLeft) {
            left = maxLeft;
        }

        $wrapper.show();
        $wrapper.css({'left': left});
    }

    function triggerActionMenu(stock, time) {
        var bandRange = getPlotBandRange(stock, time);

        if (bandRange) {
            if (bandRange.from == time || bandRange.to == time) {
                cancelManual(stock, time);
            } else if (bandRange.empty) {
                buyManual(stock, time);
            } else {
                sellManual(stock, time);
            }
        } else {
            buyManual(stock, time);
        }
    }

    function startHidingActionMenu(stock) {
        stopHidingActionMenu(stock);

        actionMenuTimers[stock] = setTimeout(function () {
            var $menu = $('#action-menu-' + stock);
            $menu.children().hide();
            actionMenuTimers[stock] = null;
        }, 500);
    }

    function stopHidingActionMenu(stock) {
        if (actionMenuTimers[stock]) {
            clearTimeout(actionMenuTimers[stock]);
            actionMenuTimers[stock] = null;
        }
    }

    interruptTasks.push(function () {
        for (var s = 0; s < numStocks; s++) {
            startHidingActionMenu(s);
        }
    });

    function showChartError(stock, time) {
        if (lenientMode) {
            return;
        }

        function checkError(t) {
            if (tradeTable[t]) {
                for (var i = 0; i < tradeTable[t].length; i++) {
                    var trade = tradeTable[t][i];

                    if (trade.stock == stock && trade.result.error != '') {
                        var sticky = true;
                        showError(trade.result.error, sticky);
                        return true;
                    }
                }
            }
        }

        if (checkError(time)) {
            return;
        }

        var bandRange = getPlotBandRange(stock, time);

        if (bandRange && bandRange.position == 0 && !bandRange.empty) {
            if (checkError(bandRange.from)) {
                return;
            }
        }
    }

    /*API*/
    function Trade(trade) {
        validateTradeID(trade.id, true);
        validateStock(trade.stock, true);
        validateTime(trade.time, true);
        validateSide(trade.side, true);
        validateSize(trade.quantity, false);

        this.id       = trade.id;
        this.stock    = trade.stock;
        this.time     = trade.time;
        this.side     = trade.side;
        this.quantity = trade.quantity;
    }

    /*API*/
    function TradeResult(trade) {
        validateTradeID(trade.id, true);

        var trade = tradeList[trade.id];
        calculateTrades(trade.time);

        for (var s = 0; s < numStocks; s++) {
            validateSize(trade.result.positions[s], true);
        }

        this.quantity = trade.result.quantity;
        this.position = trade.result.positions[trade.stock];
        this.balance  = trade.result.balance;
        this.totalPV  = trade.result.totalPV;
        this.error    = trade.result.error;

        this.positions = [];

        for (var s = 0; s < numStocks; s++) {
            this.positions[s] = trade.result.positions[s];
        }
    }

    /*API*/
    Trade.prototype.cancel = function () {
        validateTradeID(this.id);

        var trade = tradeList[this.id];
        removeTrade(trade);

        return this;
    };

    /*API*/
    Trade.prototype.update = function (quantity) {
        validateTradeID(this.id, true);
        validateSize(quantity, false);

        var trade = tradeList[this.id];
        trade.quantity = this.quantity = quantity;
        setCalculateTime(trade.time);

        return this;
    };

    /*API*/
    Trade.prototype.isCanceled = function () {
        validateSize(this.id, true);

        if (this.id >= tradeList.length) {
            throw (lang == 'en' ? 'Invalid' : '無効な') + ' Trade ID: ' + formatInvalidInput(this.id);
        }

        var trade = tradeList[this.id];
        return trade === null;
    };

    /*API*/
    Trade.prototype.isError = function () {
        validateTradeID(this.id, true);

        var trade = tradeList[this.id];
        calculateTrades(trade.time);

        return trade.result.error != '';
    };

    /*API*/
    Trade.prototype.getResult = function () {
        validateTradeID(this.id, true);
        return new TradeResult(tradeList[this.id]);
    };

    /*API*/
    function getTrades() {
        var stock, time, side;

        if (arguments.length <= 1) {
            time = arguments[0];
            validateTime(time, true);
        } else {
            stock = arguments[0];
            time = arguments[1];
            side = arguments[2];
            validateStock(stock, true);
            validateTime(time, true);
            validateSide(side, false);
        }

        var trades = [];

        if (tradeTable[time]) {
            var stockCheck = (typeof stock != 'undefined');
            var sideCheck = (typeof side != 'undefined');

            for (var i = 0; i < tradeTable[time].length; i++) {
                var trade = tradeTable[time][i];

                if ((!stockCheck || trade.stock == stock) && (!sideCheck || side == trade.side)) {
                    trades.push(new Trade(trade));
                }
            }
        }

        return trades;
    }

    /*API*/
    function cancel(stock, time, side) {
        validateStock(stock, true);
        validateTime(time, true);
        validateSide(side, false);

        removeTrades(stock, time, side);
    }

    function cancelManual(stock, time, side) {
        setEvent('trade');
        removeTrades(stock, time, side);

        lastManualTrade = {
            time: time,
            stock: stock,
            side: side
        };
    }

    function removeTrades(stock, time, side) {
        if (tradeTable[time]) {
            var sideCheck = (typeof side != 'undefined');
            var otherTrades = [];
            var removed = false;

            for (var i = 0; i < tradeTable[time].length; i++) {
                var trade = tradeTable[time][i];

                if (trade.stock == stock && (!sideCheck || side == trade.side)) {
                    if (trade.$tr) {
                        trade.$tr.remove();
                    }

                    tradeList[trade.id] = null;
                    removed = true;
                } else {
                    otherTrades.push(trade);
                }
            }

            if (otherTrades.length > 0) {
                tradeTable[time] = otherTrades;
            } else {
                delete tradeTable[time];
            }

            if (removed) {
                setCalculateTime(time);
            }
        }
    }

    function removeTrade(targetTrade, manual) {
        var time = targetTrade.time;

        if (tradeTable[time]) {
            var otherTrades = [];
            var removed = false;

            for (var i = 0; i < tradeTable[time].length; i++) {
                var trade = tradeTable[time][i];

                if (trade == targetTrade) {
                    if (trade.$tr) {
                        trade.$tr.remove();
                    }

                    tradeList[trade.id] = null;
                    removed = true;
                } else {
                    otherTrades.push(trade);
                }
            }

            if (otherTrades.length > 0) {
                tradeTable[time] = otherTrades;
            } else {
                delete tradeTable[time];
            }

            if (removed) {
                setCalculateTime(time);
            }
        }

        if (manual) {
            lastManualTrade = {
                time: time,
                stock: targetTrade.stock,
                side: targetTrade.side
            };
        }
    }

    function clearPlotBand(stock, time) {
        var bandRange = getPlotBandRange(stock, time);

        if (!bandRange) {
            return;
        }

        var from = Math.max(0, bandRange.from);
        var to = Math.min(endTime - 1, bandRange.to);

        for (var t = from; t <= to; t++) {
            if (t == bandRange.from) {
                cancelManual(stock, t, BUY);
            } else if (t == bandRange.to) {
                cancelManual(stock, t, SELL);
            } else {
                cancelManual(stock, t);
            }
        }

        setCalculateTime(from);
    }

    /*API*/
    function update(stock, time) {
        var side, quantity;

        if (arguments.length <= 3) {
            quantity = arguments[2];
        } else {
            side = arguments[2];
            quantity = arguments[3];
        }

        validateStock(stock, true);
        validateTime(time, true);
        validateSize(quantity, false);
        validateSide(side, false);

        var updated = false;

        if (tradeTable[time]) {
            var sideCheck = (typeof side != 'undefined');

            for (var i = 0; i < tradeTable[time].length; i++) {
                var trade = tradeTable[time][i];

                if (trade.stock == stock && (!sideCheck || side == trade.side)) {
                    trade.quantity = quantity;
                    updated = true;
                    break;
                }
            }
        }

        if (updated) {
            setCalculateTime(time);
        }
    }

    /*API*/
    function isError(stock, time, side) {
        validateStock(stock, true);
        validateTime(time, true);
        validateSide(side, false);

        if (!tradeTable[time]) {
            return false;
        }

        calculateTrades(time);

        var sideCheck = (typeof side != 'undefined');

        for (var i = 0; i < tradeTable[time].length; i++) {
            var trade = tradeTable[time][i];

            if (trade.stock == stock && (!sideCheck || side == trade.side)) {
                if (trade.result.error != '') {
                    return true;
                }
            }
        }

        return false;
    }

    var calculateTime = endTime;
    var calculateTimer = null;

    interruptTasks.push(function () {
        if (calculateTimer) {
            clearTimeout(calculateTimer);
            calculateTimer = null;
            calculateTime = endTime;
        }
    });

    function setCalculateTime(time) {
        if (calculateTime > time) {
            calculateTime = time;

            if (!calculateTimer) {
                calculateTimer = setTimeout(function () {
                    calculateTimer = null;
                    calculateTrades();
                }, 0);
            }
        }
    }

    function calculateTrades(toTime, suppressRedraw) {
        if (typeof toTime == 'undefined') {
            toTime = endTime - 1;
        }

        if (calculateTime > toTime) {
            return;
        }

        var fromTime = calculateTime;
        calculateTime = toTime + 1;

        var lastResult = createLastResult(fromTime);

        for (var t = fromTime; t <= toTime; t++) {
            if (!tradeTable[t]) {
                continue;
            }

            for (var i = 0; i < tradeTable[t].length; i++) {
                var trade = tradeTable[t][i];
                var stock = trade.stock;
                var result = calculateResult(trade, lastResult);
                lastResult = trade.result = result;
            }
        }

        if (!suppressRedraw) {
            setRedrawTime(fromTime);
        }
    }

    var redrawTime = endTime;
    var redrawTimer = null;

    interruptTasks.push(function () {
        if (redrawTimer) {
            clearTimeout(redrawTimer);
            redrawTimer = null;
            redrawTime = endTime;
        }
    });

    function setRedrawTime(time) {
        if (redrawTime > time) {
            redrawTime = time;
        }

        if (!redrawTimer) {
            redrawTimer = setTimeout(function () {
                redrawTimer = null;
                redrawTrades();
            }, 0);
        }
    }

    function redrawTrades() {
        if (redrawTime >= endTime) {
            return;
        }

        var fromTime = redrawTime;

        if (calculateTime < endTime) {
            calculateTrades(endTime - 1, true);
        }

        redrawTime = endTime;

        var bandRangeTable = createBandRangeTable(plotBandRanges, fromTime);
        var lastResult = createLastResult(fromTime);
        var lastSuccess = lastResult;

        var errors = 0;
        var errorReported = false;
        var reportRelatedError = false;

        for (var t = fromTime; t < endTime; t++) {
            if (!tradeTable[t]) {
                continue;
            }

            for (var i = 0; i < tradeTable[t].length; i++) {
                var trade = tradeTable[t][i];
                var stock = trade.stock;
                updateBandRanges(bandRangeTable, trade);
                renderTrade(trade);
                var result = trade.result;

                if (result.error != '') {
                    errors++;

                    if (lastManualTrade) {
                        if (lastManualTrade.stock == stock && lastManualTrade.time == t) {
                            if (!errorReported) {
                                errorReported = true;
                                if (!lenientMode) {
                                    showError(result.error, true);
                                }
                            }
                        } else if (reportRelatedError) {
                            if (trade.side == BUY && lastManualTrade.stock != stock) {
                                if (!errorReported) {
                                    errorReported = true;
                                    showError(result.error, true);
                                }
                            }
                        }
                    }
                } else {
                    lastSuccess = result;
                }

                lastResult = result;
            }
        }

        for (var s = 0; s < numStocks; s++) {
            plotBandRanges[s] = bandRangeTable[s].ranges;
        }

        renderPlotBands(plotBandRanges);
        setScore(lastSuccess.totalPV);

        if (errors > 0 && !lastManualTrade && !lenientMode) {
            if (lang == 'en') {
                showError(errors + ' errors occurred. See the trade table.');
            } else {
                showError(errors + '個のエラーが発生しました。取引一覧表を参照してください。');
            }
        }

        if (lastManualTrade && !errorReported) {
            hideAlertPopup(0, true);
        }

        lastManualTrade = null;

        $('#result-output').hide();
    }

    function createBandRangeTable(bandRanges, fromTime) {
        var bandRangeTable = [];

        for (var s = 0; s < numStocks; s++) {
            var ranges = [];
            var openRange = null;

            for (var b = 0; b < bandRanges[s].length; b++) {
                if (bandRanges[s][b].to < fromTime) {
                    ranges.push(bandRanges[s][b]);
                } else if (bandRanges[s][b].from < fromTime) {
                    openRange = bandRanges[s][b];
                    openRange.to = endTime;

                    if (!openRange.empty) {
                        ranges.push(openRange);
                    }
                } else {
                    break;
                }
            }

            if (openRange == null) {
                var from = -1;

                if (ranges.length > 0) {
                    from = ranges[ranges.length - 1].to;
                }

                openRange = {
                    from: from,
                    to: endTime,
                    position: 0,
                    empty: true
                };
            }

            bandRangeTable[s] = {
                ranges: ranges,
                openRange: openRange
            };
        }

        return bandRangeTable;
    }

    function updateBandRanges(bandTable, trade) {
        var stock = trade.stock;
        var position = trade.result.positions[stock];

        var ranges = bandTable[stock].ranges;
        var openRange = bandTable[stock].openRange;

        if (openRange != null) {
            openRange.to = trade.time;

            if (trade.side == SELL && openRange.empty) {
                ranges.push(openRange);
            }

            openRange = null;
        }

        var empty = (trade.side == SELL && position == 0);

        openRange = {
            from: trade.time,
            to: endTime,
            position: (empty ? 0 : position),
            empty: empty
        };

        if (!empty) {
            ranges.push(openRange);
        }

        bandTable[stock].openRange = openRange;
    }

    function formatMaxTradeQuantityError(trade, result) {
        var stock = trade.stock;
        var time = trade.time;
        var sumQuantity = result.quantity + result.tradedQuantities[stock];

        if (lang == 'en') {
            return "［Time " + time + "］ " + stockLabels[stock] + ": Cannot trade more than " + maxTradeQuantity + " shares." +
                " (Total Quantity: " + sumQuantity + ")";
        } else {
            return "［時間" + time + "］ 「" + stockLabels[stock] + "」は" + maxTradeQuantity + "株を超えて取引することはできません。" +
                "（合計数量：" + sumQuantity + "）";
        }
    }

    function formatMaxPositionError(trade, result) {
        var stock = trade.stock;
        var time = trade.time;
        var quantity = result.quantity;

        if (lang == 'en') {
            return "［Time " + time + "］ " + stockLabels[stock] + ": Cannot own more than " + maxPosition + " shares." +
                " (Position: " + result.positions[stock] + ", Quantity: " + quantity + ")";
        } else {
            return "［時間" + time + "］ 「" + stockLabels[stock] + "」を最大" + maxPosition + "株までしか保有することはできません。" +
                "（保有株数：" + result.positions[stock] + "、購入株数：" + quantity + "）";
        }
    }

    function formatInsufficientBalanceError(trade, result) {
        var stock = trade.stock;
        var time = trade.time;
        var price = quotes[stock][time];
        var quantity = result.quantity;
        var amount = result.amount;
        var commission = result.commission;

        if (quantity > 0) {
            if (lang == 'en') {
                result.error = "［Time " + time + "］ " + stockLabels[stock] + ": Insufficient cash to buy." +
                    " (Balance: " + result.balance + ", Amount: " + amount + (commission > 0 ? (", Commission: " + commission) : "") + ")";
            } else {
                result.error = "［時間" + time + "］ 「" + stockLabels[stock] + "」の購入資金が不足しています。" +
                    "（現金残高：" + result.balance + "円、購入額：" + amount + "円" + (commission > 0 ? ("、手数料：" + commission + "円") : "") + "）";
            }
        } else {
            if (lang == 'en') {
                return "［Time " + time + "］ " + stockLabels[stock] + ": Insufficient cash to buy." +
                    " (Balance: " + result.balance + ", Price: " + price + (commission > 0 ? (", Commission: " + commission) : "") + ")";
            } else {
                return "［時間" + time + "］ 「" + stockLabels[stock] + "」の購入資金が不足しています。" +
                    "（現金残高：" + result.balance + "円、株価：" + price + "円" + (commission > 0 ? ("、手数料：" + commission + "円") : "") + "）";
            }
        }
    }

    function formatMinIntervalError(trade, result) {
        var stock = trade.stock;
        var time = trade.time;

        if (lang == 'en') {
            return "［Time " + time + "］ " + stockLabels[stock] + ": Cannot sell within " + minInterval + " intervals." +
                " (Last Purchase: " + result.lastBuyTimes[stock] + ", Sale: " + time + ")";
        } else {
            return "［時間" + time + "］ 「" + stockLabels[stock] + "」を" + minInterval + "期間以内に売却することはできません。" +
                "（直近の購入時間：" + result.lastBuyTimes[stock] + "、売却時間：" + time + "）";
        }
    }

    function formatInsufficientPositionError(trade, result) {
        var stock = trade.stock;
        var time = trade.time;
        var quantity = result.quantity;

        if (quantity > 0) {
            if (lang == 'en') {
                return "［Time " + time + "］ " + stockLabels[stock] + ": Insufficient shares to sell." +
                    " (Position: " + result.positions[stock] + ", Quantity: " + quantity + ")";
            } else {
                return "［時間" + time + "］ 「" + stockLabels[stock] + "」を売却するための保有数が不足しています。" +
                    "（保有株数：" + result.positions[stock] + "、売却株数：" + quantity + "）";
            }
        } else {
            if (lang == 'en') {
                return "［Time " + time + "］ " + stockLabels[stock] + ": No shares to sell.";
            } else {
                return "［時間" + time + "］ 「" + stockLabels[stock] + "」を保有していないため、売却できません。";
            }
        }
    }

    function calculateQuantity(trade, lastResult) {
        var stock = trade.stock;
        var time = trade.time;
        var price = quotes[stock][time];

        var quantity = 0;

        if (trade.side == BUY) {
            var f = commissionRate ? commissionRate : 0;
            quantity = Math.floor(lastResult.balance / (price * (1 + f)));

            if (typeof maxPosition != 'undefined') {
                if (quantity + lastResult.positions[stock] > maxPosition) {
                    quantity = maxPosition - lastResult.positions[stock];
                }
            }
        } else if (trade.side == SELL) {
            quantity = lastResult.positions[stock];
        }

        if (typeof maxTradeQuantity != 'undefined') {
            var tradedQuantity = (lastResult.time == time ? lastResult.tradedQuantities[stock] : 0);
            if (quantity > maxTradeQuantity - tradedQuantity) {
                quantity = maxTradeQuantity - tradedQuantity;
            }
        }

        return quantity;
    }

    function createLastResult(fromTime) {
        var lastResult;

        if (fromTime > 0) {
            var lastTrade = getLastTrade(fromTime - 1);

            if (lastTrade) {
                lastResult = lastTrade.result;
            }
        }

        if (!lastResult) {
            lastResult = {
                time: -1,
                stock: -1,
                balance: initialBalance,
                positions: [],
                totalPV: initialBalance,
                error: "",
                lastBuyTimes: [],
                tradedQuantities: []
            };

            for (var s = 0; s < numStocks; s++) {
                lastResult.positions[s] = 0;
                lastResult.lastBuyTimes[s] = -1;
            }
        }

        return lastResult;
    }

    function createResult(trade, lastResult) {
        var stock = trade.stock;
        var time = trade.time;
        var price = quotes[stock][time];
        var quantity = trade.quantity;

        if (typeof quantity == 'undefined') {
            quantity = calculateQuantity(trade, lastResult);
        }

        var amount = price * quantity;
        var commission = (commissionRate ? Math.ceil(amount * commissionRate) : 0);
        var change = (trade.side == BUY ? -amount : amount) - commission;

        var result = {
            stock: stock,
            time: time,
            quantity: quantity,
            amount: amount,
            commission: commission,
            change: change,
            balance: lastResult.balance,
            positions: [],
            totalPV: lastResult.totalPV,
            error: "",
            lastBuyTimes: [],
            tradedQuantities: []
        };

        for (var s = 0; s < numStocks; s++) {
            result.positions[s] = lastResult.positions[s];
            result.lastBuyTimes[s] = lastResult.lastBuyTimes[s];
            result.tradedQuantities[s] = (lastResult.time == time ? lastResult.tradedQuantities[s] : 0);
        }

        return result;
    }

    function calculateResult(trade, lastResult) {
        var stock = trade.stock;
        var time = trade.time;
        var price = quotes[stock][time];

        var result = createResult(trade, lastResult);
        var quantity = result.quantity;
        var amount = result.amount;
        var commission = result.commission;
        var change = result.change;

        // Validate trade
        var success = false;
        var maxTradeQuantityReached = false;

        if (maxTradeQuantity) {
            var tradedQuantity = (lastResult.time == time ? lastResult.tradedQuantities[stock] : 0);
            if (tradedQuantity >= maxTradeQuantity || tradedQuantity + quantity > maxTradeQuantity) {
                maxTradeQuantityReached = true;
            }
        }

        if (trade.side == BUY) {
            if (lenientMode) {
                success = true;
            } else if (maxTradeQuantity && maxTradeQuantityReached) {
                result.error = formatMaxTradeQuantityError(trade, result)
            } else if (maxPosition && (result.positions[stock] + quantity > maxPosition)) {
                result.error = formatMaxPositionError(trade, result);
            } else if (result.balance >= (amount + commission) && quantity > 0) {
                success = true;
            } else {
                result.error = formatInsufficientBalanceError(trade, result);
            }
        } else if (trade.side == SELL) {
            if (lenientMode) {
                success = true;
            } else if (maxTradeQuantity && maxTradeQuantityReached) {
                result.error = formatMaxTradeQuantityError(trade, result)
            } else if (minInterval && (time - lastResult.lastBuyTimes[stock] < minInterval)) {
                result.error = formatMinIntervalError(trade, result);
            } else if (result.positions[stock] >= quantity && quantity > 0) {
                success = true;
            } else {
                result.error = formatInsufficientPositionError(trade, result);
            }
        }

        // Update balance and positions
        if (success) {
            if (trade.side == BUY) {
                result.positions[stock] += quantity;
                result.lastBuyTimes[stock] = time;
            } else if (trade.side == SELL) {
                result.positions[stock] -= quantity;
            }

            result.balance += change;
            result.tradedQuantities[stock] += quantity;
        }

        // Update total PV
        result.totalPV = result.balance;

        for (var s = 0; s < numStocks; s++) {
            result.totalPV += result.positions[s] * quotes[s][time];
        }

        return result;
    }

    function createPlotBands(ranges) {
        var plotBands = [];

        for (var i = 0; i < ranges.length; i++) {
            var range = ranges[i];

            if (range.from == range.to) {
                continue;
            }
            
            var color;

            if (range.position > 0) {
                color = plotBandColor;
            } else if (range.empty) {
                color = emptyBandColor;
            } else {
                color = (lenientMode ? plotBandColor : errorBandColor);
            }

            plotBands.push({
                from: range.from,
                to: range.to,
                color: color
            });

            plotBands.push({
                from: range.from,
                to: range.to,
                borderWidth: 1,
                borderColor: '#d3d3d3',
                zIndex: 5
            });
        }

        return plotBands;
    }

    function renderTrade(trade) {
        var $tr;
        var result = trade.result;

        if (trade.$tr) {
            $tr = trade.$tr;

            if (trade.renderedResult.quantity != result.quantity) {
                $tr.find('.quantity').html(result.quantity);
            }

            if (trade.renderedResult.commission != result.commission) {
                $tr.find('.commission').html(result.commission);
            }

            if (trade.renderedResult.change != result.change ||
                    trade.renderedResult.error != result.error) {
                $tr.find('.change').html(formatChange(result));
            }

            if (trade.renderedResult.balance != result.balance) {
                $tr.find('.balance').html(result.balance);
            }

            for (var s = 0; s < numStocks; s++) {
                if (trade.renderedResult.positions[s] != result.positions[s]) {
                    $tr.find('.position-' + s).html(result.positions[s]);
                }
            }

            if (trade.renderedResult.totalPV != result.totalPV) {
                $tr.find('.totalPV').html(result.totalPV);
            }
        } else {
            $tr = $('<tr>');

            $tr.addClass('trade');
            $tr.append(makeTD(trade.time, 'time'));
            $tr.append(makeTD(trade.side ? 'Sell': 'Buy', ['side', trade.side ? 'sell' : 'buy']));
            $tr.append(makeTD(stockLabels[trade.stock], 'stock'));
            $tr.append(makeTD(quotes[trade.stock][trade.time], 'price'));

            $tr.append(makeTD(result.quantity, 'quantity'));
            $tr.append(makeTD(result.commission, 'commission'));
            $tr.append(makeTD(formatChange(result), 'change'));
            $tr.append(makeTD(result.balance, 'balance'));

            for (var s = 0; s < numStocks; s++) {
                $tr.append(makeTD(result.positions[s], ['position', 'position-' + s]));
            }

            $tr.append(makeTD(result.totalPV, 'totalPV'));
            
            var lastTrade = getLastTrade(trade.time, true);

            if (lastTrade) {
                $tr.insertAfter(lastTrade.$tr);
            } else {
                $tr.insertAfter($firstTr);
            }

            trade.$tr = $tr;
        }

        trade.renderedResult = result;

        var $error = $tr.find('.error-icon');

        $error.unbind('click');
        $error.click(function () {
            var formattedSide = '';

            if (trade.side == BUY) {
                formattedSide = (lang == 'en' ? 'Purchase ' : '購入');
            } else if (trade.side == SELL) {
                formattedSide =  (lang == 'en' ? 'Sale ' : '売却');
            }

            var message = '<h1>' + formattedSide + (lang == 'en' ? 'Error' : 'エラー') + '</h1>' +
                '<p>' + result.error + '</p>' +
                '<p>' + (lang == 'en' ? 'Remove this trade?' : 'このトレードを削除しますか？') + '</p>' +
                '<div class="dialog-menu">' +
                '<p>' +
                  '<a class="btn-capsule btn-red delete-button enter-key">' +
                    (lang == 'en' ? 'Remove' : '削除') +
                  '</a>' +
                  '&nbsp;&nbsp;' +
                  '<a class="btn-capsule escape-button">' +
                    (lang == 'en' ? 'Cancel' : 'キャンセル') +
                  '</a>' +
                '</p>' +
                '</div>';

            var $dialog = renderDialog(message, 'reset-dialog', false);
            var $close = $dialog.find('.close-button');

            var $delete = $dialog.find('.delete-button');

            $delete.click(function () {
                removeTrade(trade);
                $close.click();
            });

            var $escape = $dialog.find('.escape-button');

            $escape.click(function() {
                $close.click();
            });
        });

        $error.unbind('mouseover');
        $error.mouseover(function () {
            if (result.error != '') {
                showError(result.error);
            } else {
                hideAlertPopup(500);
            }
        });

        $error.unbind('mouseout');
        $error.mouseout(function () {
            hideAlertPopup(500);
        });
    }

    function renderPlotBands(bandRanges) {
        for (var s = 0; s < numStocks; s++) {
            charts[s].xAxis[0].update({
                plotBands: createPlotBands(bandRanges[s])
            });
        }
    }

    function renderDialog(content, className, successPopup) {
        var $popup = $('#modal-dialog');
        $popup.attr('class', className);

        var duration = (successPopup ? 400 : 0);
        var $overlay = $('#light-overlay');
        var closeButton = '<div style="float: right"><a class="close-button">×</a></div>';

        $popup.html(closeButton + content);

        makeMissionLink($popup.find('.next-mission'), +1);

        var $enter = $popup.find('.enter-key');

        keyboardHandlers[ENTER_KEY] = keyboardHandlers[SPACE_KEY] = function () {
            $enter.click();
        }

        var $close = $popup.find('.close-button');

        function showResult() {
            setTimeout(function () {
                $('#result-button').click();
            }, duration);
        }

        $popup.find('.show-result').unbind('click');
        $popup.find('.show-result').click(function () {
            $popup.hide(duration);
            $overlay.hide(duration);
            showResult();
        });

        $close.click(function () {
            $popup.hide(duration);
            $overlay.hide(duration);
        });

        keyboardHandlers[ESC_KEY] = function () {
            $close.click();
        };

        $popup.find('.escape-key').click(function () {
            $close.click();
        });

        $overlay.unbind('click');
        $overlay.click(function () {
            $popup.hide(duration);
            $overlay.hide(duration);

            if (successPopup && currentMission == missionConfigs.length - 1) {
                showResult();
            }
        });

        $popup.show(duration);
        $overlay.show(duration);

        return $popup;
    }

    function closeDialog() {
        $('#modal-dialog').find('.close-button').click();
    }

    function showInfo(html, sticky) {
        showAlertPopup(html, false, sticky);

        if (!sticky) {
            console.info(html);
        }
    }

    function showComplete(html, sticky) {
        showAlertPopup(html, true, sticky);

        if (!sticky) {
            console.info(html);
        }
    }

    function showError(html, sticky) {
        showAlertPopup(html, true, sticky);

        if (!sticky) {
            console.error(html);
        }
    }

    var alertTimer = null;
    var alertShown = false;
    var alertSticky = false;

    function showAlertPopup(html, isError, sticky) {
        var $popup = $('#alert-popup');
        $popup.html(html);

        if (isError) {
            $popup.addClass('error');
        } else {
            $popup.removeClass('error');
        }

        if (alertTimer) {
            clearTimeout(alertTimer);
            alertTimer = null;
        }

        if (!alertShown) {
            var $wrapper = $('#alert-wrapper');
            $wrapper.show();
            $popup.show();
            $popup.stop();
            $popup.css({opacity: 0.0, top: 30});
            $popup.animate({opacity: 1.0, top: 0}, 400);
            alertShown = true;
        }

        if (!sticky) {
            hideAlertPopup(4000);
        }

        alertSticky = sticky;
    }

    function hideAlertPopup(delay, ifSticky) {
        if (!alertShown) {
            return;
        }

        if (ifSticky && !alertSticky) {
            return;
        }

        if (alertTimer) {
            clearTimeout(alertTimer);
            alertTimer = null;
        }

        if (delay) {
            alertTimer = setTimeout(hideAlertPopup, delay);
        } else {
            var $popup = $('#alert-popup');
            var $wrapper = $('#alert-wrapper');
            $popup.stop();
            $popup.css({opacity: 1.0, top: 0});
            $popup.animate({opacity: 0.0, top: 30}, 400, function () {
                $popup.hide();
                $wrapper.hide();
            });
            alertShown = false;
            alertSticky = false;
        }
    }

    interruptTasks.push(function () {
        hideAlertPopup();
    });

    function formatChange(result) {
        var error = '';

        if (result.error) {
            var title = (lang == 'en' ? 'Click to remove this trade' : 'クリックすると、このトレードを削除することができます');
            error = '<span class="error-icon" title="' + title + '"></span>';
        }

        return (result.change > 0 ? '+' : '') + result.change + error;
    }

    function makeTD(label, className) {
        var $td = $('<td>');
        $td.html(label);

        if (typeof className == 'object') {
            for (var i in className) {
                $td.addClass(className[i]);
            }
        } else {
            $td.addClass(className);
        }

        return $td;
    }

    $('#execute-button').click(function (event) {
        setEvent('execute');
        executeScript();
    });

    $('#execute-example').click(function (event) {
        setEvent('example');

        var script = getExampleScript();

        if (!getScript().match(/\S/)) {
            setScript(script);
        }

        executeScript(script);

        if ((event.ctrlKey || event.metaKey) && currentMission > 0) {
            renderDialog(popupMessage, 'success-dialog', true);
        }
    });

    setScript(getExampleScript());

    function viewChart() {
        window.scrollTo(0, $('#scroll-anchor').offset().top - 30);
    }

    function viewTable() {
        window.scrollTo(0, $('#trade-table').offset().top - 30);
    }

    function executeScript(script) {
        if (!script) {
            script = getScript();
        }

        reset();
        autoSaveScript(true);
        setPublicAPI();

        try {
            globalEval(script);
            viewChart();
            blurScript();
        } catch(ex) {
            if (lang == 'en') {
                showError("Script error:\n" + ex);
            } else {
                showError("スクリプトにエラーがあります：\n" + ex);
            }
        }
    }

    var displayedScore;
    var scoreTimer = null;
    var scoreAchieved = false;
    var maxScore;
    var scoreValidated;

    function setScore(score) {
        if (typeof maxScore == 'undefined' || maxScore < score) {
            maxScore = score;
            if (maxScore >= validationScore) {
                setEvent('score', null, score);
                setEvent(score >= targetBalance ? 'achieve' : 'attempt');
                var s = new Number(currentSeed).toString(16);
                var p = new Number(score).toString(16);
                var m = new Number(currentMission + 1).toString(16);
                var t = new Number(loadTime).toString(16);
                $.ajax({
                    url: (lang == 'en' ? '../' : '') + 'libs/result.js',
                    data: {s: s, p: p, m: m, t: t},
                    dataType: 'text'
                }).done(function (data) {
                    scoreValidated = globalEval(data);
                });
            }
        }

        if (typeof displayedScore == 'undefined') {
            displayedScore = score;
            renderScore(displayedScore);
        } else if (displayedScore != score) {
            if (scoreTimer) {
                clearInterval(scoreTimer);
                scoreTimer = null;
            }

            var delta = Math.round((score - displayedScore) / 20);

            scoreTimer = setInterval(function () {
                displayedScore += delta;

                if (delta > 0 && displayedScore > score) {
                    displayedScore = score;
                } else if (delta < 0 && displayedScore < score) {
                    displayedScore = score;
                }

                renderScore(displayedScore);

                if (!scoreAchieved && displayedScore > targetBalance) {
                    scoreAchieved = true;
                    renderDialog(popupMessage, 'success-dialog', true);
                } else if (scoreAchieved && displayedScore < targetBalance) {
                    scoreAchieved = false;
                }

                if (displayedScore == score) {
                    clearInterval(scoreTimer);
                    scoreTimer = null;
                }
            }, 20);
        }
    }

    function renderScore(score) {
        var percent = Math.floor(100 * score / targetBalance);

        var result = '';

        if (lang == 'en') {
            $('#result').html(
                'Score: <br><span class="score">' +
                '<span>' + formatAmount(score) + '</span>' +
                '</span><br>' +
                '<small>Completed: </small></span>' +
                '<span class="score-percent">' +
                percent +
                '%'
            );
        } else {
            $('#result').html(
                '資産総額: <br><span class="score">' +
                '<span>' + formatAmount(score) + '</span>' +
                '</span><br>' +
                '<small>達成率: </small></span>' +
                '<span class="score-percent">' +
                percent +
                '%'
            );
        }
    }

    function formatNumber(number) {
        return number.toString().replace(/(?=(?:\d{3})+(?!\d))/g, ",").replace(/^,+/, '');
    }

    function formatPercent(number) {
        return Math.round(number * 100) + '%';
    }

    function formatAmount(amount) {
        if (lang == 'en') {
            return 'JPY ' + formatNumber(amount);
        } else {
            var result = [];

            for (var i = 0; i < amountUnits.length; i++) {
                var label = amountUnits[i].label;
                var value = amountUnits[i].value;

                if (amount >= value) {
                    var n = Math.floor(amount / value);
                    amount -= n * value;
                    result.push(n + '<small>' + label + '</small>');
                }
            }

            if (amount > 0) {
                result.push(amount);
            }

            result.push('<small>円</small>');
            return result.join('');
        }
    }

    function formatDate(month, day) {
        if (lang == 'en') {
            var months = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];

            return months[month - 1] + ' ' + day;
        } else {
            return (month) + '月' + day + '日';
        }
    }

    function formatTime(hour, minute) {
        if (lang == 'en') {
            var ampm = ' AM';

            if (hour == 0) {
                hour = 12;
            } else if (hour >= 12) {
                ampm = ' PM';
            }

            if (minute < 10) {
                minute = '0' + minute;
            }

            return hour + ':' + minute + ampm;
        } else {
            return hour + '時' + minute + '分';
        }
    }

    function modulate(i, sampleRate, frequency, x) {
        return Math.sin(2 * Math.PI * (i / sampleRate) * frequency + x);
    }

    var MUSIC_STATE_INIT       = 0;
    var MUSIC_STATE_PREPARED   = 1;
    var MUSIC_STATE_PROCESSING = 2;
    var MUSIC_STATE_PLAYING    = 3;
    var MUSIC_STATE_PAUSED     = 4;

    var music = {
        state: MUSIC_STATE_INIT,
        sampleRate: 44100,
        audioSupported: false,
        audio: null,
        cache: {},
        entries: [],
        currentTime: 0,
        keySignatures: [],
        defaultOptions: [],
        visualStates: [],
        visualTimers: [],
        stopTimer: null,
        chordContext: null,
        pianoMode: false
    };

    music.audioSupported = (function () {
        if (!Audio) {
            return false;
        }

        var audio = document.createElement('audio');

        if (!audio) {
            return false;
        }

        var result = audio.canPlayType('audio/wav');
        return result != '';
    })();

    music.instruments = [
        {
            name: 'piano',
            stockIndex: 0,
            attack: function() {
                return 0.0008;
            },
            dampen: function(sampleRate, frequency) {
                return Math.pow(0.5 * Math.log(frequency / sampleRate), 2);
            },
            initContext: function () {
                return {};
            },
            wave: function(i, sampleRate, frequency) {
                var x = Math.pow(modulate(i, sampleRate, frequency, 0), 2) +
                        (0.75 * modulate(i, sampleRate, frequency, 0.25)) +
                        (0.1 * modulate(i, sampleRate, frequency, 0.5));
                return modulate(i, sampleRate, frequency, x);
            }
        },
        {
            name: 'organ',
            stockIndex: 1,
            attack: function() {
                return 0.1;
            },
            dampen: function(sampleRate, frequency) {
                return 1 + (frequency * 0.01);
            },
            initContext: function () {
                return {};
            },
            wave: function(i, sampleRate, frequency) {
                var x = modulate(i, sampleRate, frequency, 0) +
                        0.5 * modulate(i, sampleRate, frequency, 0.25) +
                        0.25 * modulate(i, sampleRate, frequency, 0.5);
                return modulate(i, sampleRate, frequency, x);
            }
        },
        {
            name: 'acoustic',
            stockIndex: 2,
            attack: function() {
                return 0.032;
            },
            dampen: function() {
                return 1;
            },
            initContext: function () {
                return {
                    values: [],
                    index: 0,
                    count: 0
                };
            },
            wave: function(i, sampleRate, frequency, context) {
                var values = context.values;
                var index = context.index;
                var count = context.count;

                var period = sampleRate / frequency;
                var shouldReset = false;

                if (values.length <= Math.ceil(period)) {
                    values.push(Math.round(Math.random()) * 2 - 1);
                    return values[values.length - 1];
                } else {
                    var val = index >= (values.length - 1) ? 0 : index + 1;
                    values[index] = (values[val] + values[index]) * 0.5;

                    if (index >= Math.floor(period)) {
                        if (index < Math.ceil(period)) {
                            if ((count % 100) >= Math.floor((period - Math.floor(period)) * 100)) {
                                shouldReset = true;
                                values[index + 1] = (values[0] + values[index + 1]) * 0.5;
                                context.count++;
                            }
                        } else {
                            shouldReset = true;
                        }
                    }

                    var ret = values[index];

                    if (shouldReset) {
                        context.index = 0;
                    } else {
                        context.index++;
                    }

                    return ret;
                }
            }
        }
    ];

    music.allNotes = [
        {index:  0, name: 'C' , alt: 'C' , frequency: 261.63},
        {index:  1, name: 'C#', alt: 'Db', frequency: 277.18},
        {index:  2, name: 'D' , alt: 'D' , frequency: 293.66},
        {index:  3, name: 'D#', alt: 'Eb', frequency: 311.13},
        {index:  4, name: 'E' , alt: 'E' , frequency: 329.63},
        {index:  5, name: 'F' , alt: 'F' , frequency: 346.23},
        {index:  6, name: 'F#', alt: 'Gb', frequency: 369.99},
        {index:  7, name: 'G' , alt: 'G' , frequency: 392.00},
        {index:  8, name: 'G#', alt: 'Ab', frequency: 415.30},
        {index:  9, name: 'A' , alt: 'A' , frequency: 440.00},
        {index: 10, name: 'A#', alt: 'Bb', frequency: 466.16},
        {index: 11, name: 'B' , alt: 'B' , frequency: 493.88}
    ];

    music.noteNorms = {
        'ド': 'C', 'レ': 'D', 'ミ': 'E', 'ファ': 'F', 'ソ': 'G', 'ラ': 'A', 'シ': 'B',
        'ど': 'C', 'れ': 'D', 'み': 'E', 'ふぁ': 'F', 'そ': 'G', 'ら': 'A', 'し': 'B',

        '\u266F': '#', '\uFF03': '#', '\u266D': 'b', '\u266E': 'n',
        '\uD834\uDD2A': 'x', '\uD834\uDD2B': 'bb',
        '＋': '+', '－': '-', '―': '-', '‐': '-', 'ー': '-', '・': '.',
        '\u301C': '~', '\uFF5E': '~', '＊': '*', '※': '*',
        '（': '(', '）': ')', '｛': '{', '｝': '}', '［': '[', '］': ']', '“': '"', '”': '"',
        '　': ' ',

        '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
        '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',

        'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E', 'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H',
        'Ｉ': 'I', 'Ｊ': 'J', 'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O', 'Ｐ': 'P',
        'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T', 'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X',
        'Ｙ': 'Y', 'Ｚ': 'Z',

        'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h',
        'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o', 'ｐ': 'p',
        'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x',
        'ｙ': 'y', 'ｚ': 'z'
    };

    music.chordQualities = [
        {name: 'major'          , intervals: [0, 2, 4, 5, 7, 9, 11], symbols: ['maj', 'M', 'MA', 'Δ']},
        {name: 'minor'          , intervals: [0, 2, 3, 5, 7, 9, 10], symbols: ['min', 'm', 'MI', '-']},
        {name: 'dominant'       , intervals: [0, 2, 4, 5, 7, 9, 10], symbols: ['dom']},
        {name: 'augmented'      , intervals: [0, 2, 4, 5, 8, 9, 10], symbols: ['aug', '+']},
        {name: 'diminished'     , intervals: [0, 1, 3, 4, 6, 9,  9], symbols: ['dim', 'O', 'o', 'Ο', 'ο', '°']},
        {name: 'half-diminished', intervals: [0, 1, 3, 5, 6, 9, 10], symbols: ['Φ', 'φ']}
    ];

    music.noteMap = {};

    music.noteNormRegex = (function () {
        for (var i = 0; i < music.allNotes.length; i++) {
            music.noteMap[music.allNotes[i].name] = music.allNotes[i];
            music.noteMap[music.allNotes[i].alt] = music.allNotes[i];
        }

        var targets = [];

        for (var target in music.noteNorms) {
            targets.push(target);
        }

        return new RegExp('(' + targets.join('|') + ')', 'g');
    })();

    music.regexFrag = (function () {
        var frag = {};

        frag.pitchChar = '[A-G]';
        frag.accidental = '[#bnx\\s]*';
        frag.pitch = frag.pitchChar + '\\s*' + frag.accidental;

        frag.octaveSign = '[\\+\\-]?';
        frag.octaveDigit = '\\d*';
        frag.octave = frag.octaveSign + '\\s*' + frag.octaveDigit;

        frag.note = frag.pitch + '\\s*' + frag.octave;

        var metachars = '~\\.\\(\\)\\[\\]\\{\\}"\\*';
        var chordSymbol = '(?:' + '[^A-Za-z' + metachars + '/\\s]' + '|' + '[H-Za-z][A-Za-z]*' + ')';
        var chordPhrase = chordSymbol + '(?:\\s*' + chordSymbol + ')*';
        
        frag.chordApprox = '(?:' +
            '\\s*' + chordPhrase + '|' +
            '\\s*\\(\\s*' + chordPhrase + '\\s*\\)' + '|' +
            '\\s*/\\s*' + chordPhrase +
        ')*';

        frag.chordBass = '(?:\\s*/\\s*' + frag.note + ')?';

        frag.flowToken = '"(?:[^"]|"")*"' + '|' +
            frag.pitch + '(?:' + frag.chordApprox + frag.chordBass + '|' + frag.octave + ')' + '|' +
            '[' + metachars + ']';

        return frag;
    })();

    $('#stop-button').click(function () {
        disableKeyboardPiano();
        stopMusic();
        reset();
    });

    function initMusic() {
        if (music.state == MUSIC_STATE_PREPARED) {
            return;
        }

        stopMusic();
        setTimeout(startMusic, 0);

        music.entries = [];
        music.currentTime = 0;
        music.keySignatures = [];
        music.defaultOptions = [];

        music.state = MUSIC_STATE_PREPARED;
    }

    function getBytesLE(size, value) {
        var chunks = [];

        for (var i = 0; i < size; i++) {
            chunks.push(value & 0xFF);
            value >>= 8;
        }

        return new Uint8Array(chunks);
    }

    /*API*/
    function setDefaultSound(instCode) {
        var instrument = music.instruments[instCode];

        for (var a = 1 /*exclude first arg*/; a < arguments.length; a++) {
            if (typeof arguments[a] == 'object') {
                var options = normalizeOptions(arguments[a], instCode);
                music.defaultOptions[instCode] = options;
            } else if (typeof arguments[a] != 'undefined') {
                validateString(arguments[a], true);
                music.keySignatures[instCode] = {};

                var keySignature = normalizeNote(arguments[a]);
                var frag = music.regexFrag;

                var regex = new RegExp(
                    '(' + frag.pitchChar + ')\\s*' +
                    '(' + frag.accidental + ')\\s*' +
                    '(' + frag.octaveSign + ')\\s*' +
                    '(' + frag.octaveDigit + ')\\s*',
                'g');

                var match;
                while (match = regex.exec(keySignature)) {
                    var ch = RegExp.$1;
                    var acc = RegExp.$2;
                    var sign = RegExp.$3;
                    var digit = RegExp.$4;

                    var entry = music.keySignatures[instCode][ch] = {};
                    entry.delta = getPitchDelta(acc);
                    entry.octave = makeOctaveEntry(sign, digit);
                }
            }
        }
    }

    function makeOctaveEntry(sign, digit, defaultRelative) {
        var relative;

        if (typeof defaultRelative != 'undefined') {
            relative = defaultRelative;
        } else {
            relative = (sign == '+' || sign == '-');
        }

        var value = (digit == '' ? (relative ? 1 : null) : parseInt(digit));

        if (sign == '-') {
            value = -value;
        }

        return {
            relative: relative,
            value: value
        }
    }

    function parseOctave(notation, defaultRelative) {
        if (typeof notation == 'number') {
            return {
                relative: defaultRelative,
                value: notation
            };
        } else if (typeof notation == 'object') {
            return notation;
        }

        var frag = music.regexFrag;

        var regex = new RegExp('^\\s*' +
            '(' + frag.octaveSign + ')\\s*' +
            '(' + frag.octaveDigit + ')\\s*' +
        '$');

        if (regex.exec(notation)) {
            var sign = RegExp.$1;
            var digit = RegExp.$2;
            return makeOctaveEntry(sign, digit, defaultRelative);
        }

        return null;
    }

    function normalizeOptions(options, instCode) {
        var result = {};

        if (typeof instCode != 'undefined') {
            result.instCode = instCode;
            result.instrument = music.instruments[instCode];
        }

        for (var attr in options) {
            if (attr == 'octave') {
                var defaultRelative = true;
                result[attr] = parseOctave(options[attr], defaultRelative);
            } else {
                result[attr] = options[attr];
            }
        }

        return result;
    }

    function parseSoundNotes(notation, options) {
        if (!notation) {
            return [];
        }

        notation = normalizeNote(notation);

        var regex = new RegExp('(' + music.regexFrag.note + ')', 'g');

        var notes = [];
        var match;

        while (match = regex.exec(notation)) {
            var keyIndex = getPitchIndex(match[1], options, 4);

            var rem = keyIndex % 12;
            var octave = (keyIndex - rem) / 12;
            var note = music.allNotes[rem];
            var name = note.name;
            var frequency = note.frequency * Math.pow(2, octave - 4);

            notes.push({
                name     : name,
                octave   : octave,
                keyIndex : keyIndex,
                frequency: frequency
            });
        }

        return notes;
    }

    function getSoundCache(cacheKeys) {
        var cache = music.cache;

        for (var i = 0; i < cacheKeys.length; i++) {
            var key = cacheKeys[i];
            if (typeof cache[key] == 'undefined') {
                return;
            }
            cache = cache[key];
        }

        return cache._samples;
    }

    function setSoundCache(cacheKeys, samples) {
        var cache = music.cache;

        for (var i = 0; i < cacheKeys.length; i++) {
            var key = cacheKeys[i];
            if (typeof cache[key] == 'undefined') {
                cache[key] = {};
            }
            cache = cache[key];
        }

        cache._samples = samples;
    }

    function addSound(instCode, notation, duration, options) {
        if (!notation || !duration) {
            return;
        }

        var instrument = music.instruments[instCode];
        options = normalizeOptions(options, instCode);

        var notes = parseSoundNotes(notation, options);

        var echo = 1.0;
        var numSamples = Math.ceil(music.sampleRate * (Math.abs(duration) + echo));

        var currentTime = music.currentTime;
        var fromTime = (duration >= 0 ? currentTime : currentTime + duration);

        var fromIndex = Math.round(music.sampleRate * fromTime);
        var toIndex = fromIndex + numSamples;

        music.entries.push({
            instrument: instrument,
            notes     : notes,
            duration  : duration,
            fromTime  : fromTime,
            fromIndex : fromIndex,
            numSamples: numSamples
        });

        music.currentTime += duration;

        return music.currentTime;
    }

    function parseSoundFlow(notation) {
        notation = normalizeNote(notation);

        var regex = new RegExp('(' + music.regexFrag.flowToken + ')', 'g');

        var baseNotes = [];
        var notes = baseNotes;
        var stack = [];
        var lastNote = null;
        var lastSound = null;
        var chordDepth = 0;
        var match;

        var groupingMap = {
            '(': 'series',
            ')': 'series',
            '[': 'parallel',
            ']': 'parallel'
        };

        while (match = regex.exec(notation)) {
            var token = match[1].replace(/^\s+|\s+$/g, '');

            if (token == '(' || token == '[') {
                var note = {unit: 1, type: groupingMap[token], children: []};
                notes.push(note);
                stack.push({parent: notes, note: note});
                lastNote = null;
                notes = note.children;
            } else if (token == ')' || token == ']') {
                if (stack[stack.length - 1].note.type == groupingMap[token]) {
                    var top = stack.pop();
                    notes = top.parent;
                    lastNote = lastSound = top.note;
                } else {
                    // unmatched closing paren/bracket
                }
            } else if (token == '{') {
                chordDepth++;
            } else if (token == '}') {
                chordDepth--;
            } else if (token == '~') {
                if (lastNote) {
                    lastNote.unit++;
                } else {
                    notes.push(lastNote = {unit: 1});
                }
            } else if (token == '.') {
                if (lastNote && !lastNote.token) {
                    lastNote.unit++;
                } else {
                    notes.push(lastNote = {unit: 1});
                }
            } else if (token == "*") {
                if (lastSound) {
                    notes.push(lastNote = lastSound = $.extend(true, {}, lastSound));
                    lastSound.unit = 1;
                }
            } else {
                if (token.match(/^"(.*)"$/)) {
                    token = RegExp.$1.replace(/""/g, '"');
                }

                notes.push(lastNote = lastSound = {token: token, chord: (chordDepth > 0), unit: 1});
            }
        }

        function visitRecursive(notes) {
            for (var n = 0; n < notes.length; n++) {
                var note = notes[n];

                if (note.children) {
                    if (note.type && note.type == 'series') {
                        var sum = 0;

                        for (var c = 0; c < note.children.length; c++) {
                            sum += note.children[c].unit;
                        }

                        if (sum > 0) {
                            for (var c = 0; c < note.children.length; c++) {
                                note.children[c].unit /= sum;
                            }
                        }
                    }

                    for (var c = 0; c < note.children.length; c++) {
                        note.children[c].unit *= note.unit;
                    }

                    visitRecursive(note.children);
                }
            }
        }

        visitRecursive(baseNotes);

        return baseNotes;
    }

    function addSoundFlow(instCode, notation, unitDuration, options) {
        if (!notation || !unitDuration) {
            return;
        }

        var instrument = music.instruments[instCode];
        options = normalizeOptions(options, instCode);

        var baseNotes = parseSoundFlow(notation);

        function addRecursive(notes, rewind) {
            for (var n = 0; n < notes.length; n++) {
                var note = notes[n];
                var time = music.currentTime;
                var duration = unitDuration * note.unit;

                if (note.token) {
                    var token = (note.chord ? getChord(note.token, options) : note.token);
                    addSound(instCode, token, duration, options);
                } else if (note.children) {
                    var parallel = (note.type == 'parallel');
                    addRecursive(note.children, parallel);

                    if (parallel) {
                        music.currentTime += duration;
                    }
                } else {
                    music.currentTime += duration;
                }

                if (rewind) {
                    music.currentTime = time;
                }
            }
        }

        addRecursive(baseNotes, false);
    }

    function synthesizeSound(instrument, sampleRate, frequency, numSamples) {
        var sound = [];

        var attack = instrument.attack(sampleRate, frequency);
        var dampen = instrument.dampen(sampleRate, frequency);
        var wave = instrument.wave;
        var context = instrument.initContext();

        var attackLen = sampleRate * attack;
        var decayLen = numSamples;

        for (var i = 0; i < numSamples; i++) {
            var amp;
            if (i < attackLen) {
                amp = i / attackLen;
            } else {
                amp = Math.pow(1 - ((i - attackLen) / (decayLen - attackLen)), dampen);
            }
            sound[i] = amp * wave(i, sampleRate, frequency, context);
        }

        return sound;
    }

    function compileMusic(entries, sampleRate) {
        var minIndex = 0;
        var maxIndex = 0;

        for (var e = 0; e < entries.length; e++) {
            var entry = entries[e];
            var fromIndex = entry.fromIndex;
            var toIndex = fromIndex + entry.numSamples;

            if (maxIndex < toIndex) {
                maxIndex = toIndex;
            }

            if (minIndex > fromIndex) {
                minIndex = fromIndex;
            }
        }

        var totalLength = maxIndex - minIndex;

        var values = [];

        for (var i = 0; i < totalLength; i++) {
            values[i] = 0;
        }

        for (var e = 0; e < entries.length; e++) {
            var entry = entries[e];

            var instrument = entry.instrument;
            var notes = entry.notes;

            var fromIndex = entry.fromIndex;
            var numSamples = entry.numSamples;
            
            for (var n = 0; n < notes.length; n++) {
                var frequency = notes[n].frequency;

                var cacheKeys = [instrument.name, sampleRate, frequency, numSamples];
                var sound = getSoundCache(cacheKeys);
                if (!sound) {
                    sound = synthesizeSound(instrument, sampleRate, frequency, numSamples);
                    setSoundCache(cacheKeys, sound);
                }

                for (var i = 0; i < numSamples; i++) {
                    values[fromIndex - minIndex + i] += sound[i];
                }
            }
        }

        return {
            minIndex: minIndex,
            maxIndex: maxIndex,
            values: values
        };
    }

    function createWavBlob(values, sampleRate) {
        var maxValue = 0;

        for (var i = 0; i < values.length; i++) {
            var value = values[i];
            if (maxValue < Math.abs(value)) {
                maxValue = Math.abs(value);
            }
        }

        var bitsPerSample = 16;
        var channels = 1;
        var data = new Uint8Array(new ArrayBuffer(values.length * 2));

        for (var i = 0; i < values.length; i++) {
            var value = (maxValue == 0 ? 0 : values[i] * 0x7FFF / maxValue);
            data[2 * i] = value;
            data[2 * i + 1] = (value >> 8);
        }

        var fmtLength = 16;
        var dataLength = data.length;
        var audioFormat = 1;

        return new Blob([
            'RIFF',
            getBytesLE(4, 4 + (8 + fmtLength) + (8 + dataLength)),
            'WAVE',
            'fmt ',
            getBytesLE(4, fmtLength),
            getBytesLE(2, audioFormat),
            getBytesLE(2, channels),
            getBytesLE(4, sampleRate),
            getBytesLE(4, sampleRate * channels * bitsPerSample / 8),
            getBytesLE(2, channels * bitsPerSample / 8),
            getBytesLE(2, bitsPerSample),
            'data',
            getBytesLE(4, dataLength),
            data
        ], {
            type: 'audio/wav'
        });
    }

    function visualizeMusic(entries, sampleRate, minIndex, maxIndex) {
        for (var s = 0; s < music.instruments.length; s++) {
            if (!music.visualStates[s]) {
                music.visualStates[s] = [];
            }
        }

        var minTime = minIndex / sampleRate;
        var maxTime = maxIndex / sampleRate;

        var totalKeyCount = 96; // 12 keys * 8 octaves
        var visibleKeyCount = 64;

        var keySize = Math.ceil(endTime / visibleKeyCount); // # of time units per key
        var interval = minInterval ? Math.max(minInterval, 2 * keySize) : 2 * keySize; // buy-sell interval

        var offset = (totalKeyCount - visibleKeyCount) / 2;

        function incrementState(s, t) {
            if (music.visualStates[s][t]) {
                music.visualStates[s][t]++;
            } else {
                music.visualStates[s][t] = 1;
            }
        }

        function decrementState(s, t) {
            if (music.visualStates[s][t]) {
                if (--music.visualStates[s][t] <= 0) {
                    music.visualStates[s][t] = 0;
                    cancelManual(s, t);
                }
            }
        }

        for (var e = 0; e < entries.length; e++) {
            var entry = entries[e];
            var notes = entry.notes;

            var strokes = [];

            for (var n = 0; n < notes.length; n++) {
                var keyIndex = notes[n].keyIndex;
                var buyTime = keySize * (keyIndex - offset);
                var sellTime = buyTime + interval;

                if (0 <= buyTime && sellTime < endTime) {
                    strokes.push({
                        buyTime: buyTime,
                        sellTime: sellTime
                    });
                }
            }

            (function (entry, strokes) {
                var stockIndex = entry.instrument.stockIndex;
                var fromTime = entry.fromTime;
                var duration = entry.duration;
                var trades = [];
                
                music.visualTimers.push(setTimeout(function () {
                    for (var s = 0; s < strokes.length; s++) {
                        trades.push(addTrade(stockIndex, strokes[s].buyTime, BUY, 1, true));
                        trades.push(addTrade(stockIndex, strokes[s].sellTime, SELL, 1, true));
                    }
                }, (fromTime + minTime) * 1000));

                music.visualTimers.push(setTimeout(function () {
                    for (var t = 0; t < trades.length; t++) {
                        removeTrade(trades[t], true);
                    }
                    trades = [];
                }, (fromTime + minTime + Math.max(0, duration - 0.05)) * 1000));

            })(entry, strokes);
        }
    }

    function startMusic() {
        setEvent('music');
        
        if (music.state != MUSIC_STATE_PREPARED) {
            return;
        }

        music.state = MUSIC_STATE_PROCESSING;

        var compiledData = compileMusic(music.entries, music.sampleRate);

        if (music.audioSupported) {
            var blob = createWavBlob(compiledData.values, music.sampleRate);
            var uri = URL.createObjectURL(blob);

            if (music.audioPromise) {
                music.audioPromise.then(function () {
                    if (music.audio) {
                        music.audio.pause();
                    }
                    
                    music.audio = new Audio(uri);
                    music.audioPromise = music.audio.play();
                });
            } else {
                music.audio = new Audio(uri);
                music.audioPromise = music.audio.play();
            }
        } else {
            showError(lang == 'en' ? 'Sound is not supported' : 'ブラウザで音声の再生がサポートされていません。');
        }
    
        visualizeMusic(music.entries, music.sampleRate, compiledData.minIndex, compiledData.maxIndex);

        $('#trade-table').hide();
        $('#stop-button').show();

        lenientMode = true;

        var totalDuration = (compiledData.maxIndex - compiledData.minIndex) / music.sampleRate;

        music.stopTimer = setTimeout(function () {
            stopMusic();
            reset();
        }, totalDuration * 1000);

        music.state = MUSIC_STATE_PLAYING;
    }

    function stopMusic() {
        if (music.audioPromise) {
            music.audioPromise.then(function () {
                if (music.audio) {
                    music.audio.pause();
                    music.audio = null;
                }

                music.audioPromise = null;
            });
        }

        for (var i = 0; i < music.visualTimers.length; i++) {
            clearTimeout(music.visualTimers[i]);
        }
        music.visualTimers = [];
        music.visualStates = [];

        if (music.stopTimer) {
            clearTimeout(music.stopTimer);
            music.stopTimer = null;
        }

        if (!music.pianoMode) {
            exitMusic();
        }

        music.state = MUSIC_STATE_PAUSED;
    }

    interruptTasks.push(stopMusic);

    function exitMusic() {
        $('#stop-button').hide();
        $('#trade-table').show();
        lenientMode = false;
        setCalculateTime(0);
    }

    function normalizeNote(note) {
        return note.replace(music.noteNormRegex, function (target) {
            return music.noteNorms[target];
        });
    }

    function getPitchDelta(note, startDelta, defaultDelta) {
        var delta = (startDelta ? startDelta : 0);
        var specified = false;

        for (var i = 0; i < note.length; i++) {
            if (note[i] == '#') {
                delta++;
                specified = true;
            } else if (note[i] == 'b') {
                delta--;
                specified = true;
            } else if (note[i] == 'x') {
                delta += 2;
                specified = true;
            } else if (note[i] == 'n') {
                delta = startDelta ? startDelta : 0;
                specified = true;
            }
        }

        if (defaultDelta && !specified) {
            delta = defaultDelta;
        }

        return delta;
    }

    function determineOctave(octaveGroups) {
        var relative = 0;

        for (var g = 0; g < octaveGroups.length; g++) {
            var groupEntries = octaveGroups[g];
            var value = null;

            for (var e = 0; e < groupEntries.length; e++) {
                var entry = groupEntries[e];

                if (entry) {
                    if (typeof entry != 'object') {
                        entry = parseOctave(entry);
                    }

                    if (entry.relative) {
                        relative += entry.value;
                    } else if (value === null && entry.value !== null) {
                        value = entry.value;
                    }
                }
            }

            if (value !== null) {
                return relative + value;
            }
        }

        return relative + 4;
    }

    function getPitchIndex(note, options, baseOctave) {
        var frag = music.regexFrag;

        var regex = new RegExp(
            '^' + '\\s*(?:/\\s*)?' +
            '(' + frag.pitchChar + ')\\s*' +
            '(' + frag.accidental + ')\\s*' +
            '(' + frag.octaveSign + ')\\s*' +
            '(' + frag.octaveDigit + ')\\s*' +
            '$'
        );

        if (!note.match(regex)) {
            throw 'Invalid note: ' + note;
        }

        var ch = RegExp.$1;
        var acc = RegExp.$2;
        var sign = RegExp.$3;
        var digit = RegExp.$4;

        var keySignature;
        var defaultOptions;

        if (options && typeof options.instCode != 'undefined') {
            var inst = options.instCode;

            if (music.keySignatures[inst]) {
                keySignature = music.keySignatures[inst][ch];
            }

            if (music.defaultOptions[inst]) {
                defaultOptions = music.defaultOptions[inst];
            }
        }

        var defaultDelta = keySignature ? keySignature.delta : null;

        var idx = music.noteMap[ch].index + getPitchDelta(acc, 0, defaultDelta);

        var octave = determineOctave([
            [makeOctaveEntry(sign, digit)],
            [
                (options ? options.octave : null),
                (keySignature ? keySignature.octave : null)
            ],
            [
                (defaultOptions ? defaultOptions.octave : null),
                {relative: false, value: baseOctave}
            ]
        ]);

        return idx + octave * 12;
    }

    function formatNote(idx) {
        var rem = idx % 12;
        var octave = (idx - rem) / 12;
        return music.allNotes[rem].name + octave;
    }

    function getChordContext() {
        var chordContext = music.chordContext;

        if (chordContext) {
            return chordContext;
        }

        chordContext = {
            symbolMap: {},
            nameMap: {},
            dominant: null,
            regex: null
        };

        var pattern = {};

        for (var q = 0; q < music.chordQualities.length; q++) {
            var quality = music.chordQualities[q];

            var name = quality.name.toLowerCase();
            chordContext.nameMap[name] = quality;
            pattern[name] = true;

            for (var s = 0; s < quality.symbols.length; s++) {
                var symbol = quality.symbols[s];
                chordContext.symbolMap[symbol] = quality;
                pattern[symbol.toLowerCase()] = true;
            }

            if (name == 'dominant') {
                chordContext.dominant = quality;
            }
        }

        var chunks = ['add', 'added', 'sus', 'suspended', 'alt', 'altered'];

        for (var symbol in pattern) {
            chunks.push((symbol == '+' ? '\\' : '') + symbol);
        }

        chunks.sort(function (a, b) {
            return a.length < b.length ? 1 : (a.length > b.length ? -1 : 0);
        });

        chordContext.regexInline = '/' + '|' +
            '(?:' + chunks.join('|') + ')' + '\\s*' + '\\d*' + '|' +
            music.regexFrag.accidental + '\\d+';

        chordContext.regex = new RegExp('(' + chordContext.regexInline + ')', 'gi');

        music.chordContext = chordContext;

        return chordContext;
    }

    function getChordTokens(notation) {
        var regex = getChordContext().regex;
        var tokens = [];
        var match;

        while (match = regex.exec(notation)) {
            tokens.push(match[1]);
        }

        return tokens;
    }

    function getChordSequence(notation) {
        var tokens = getChordTokens(notation);

        var chordContext = getChordContext();
        var symbolMap = chordContext.symbolMap;
        var nameMap   = chordContext.nameMap;
        var dominant  = chordContext.dominant;

        var added = false;
        var sequence = [];

        for (var t = 0; t < tokens.length; t++) {
            var token = tokens[t];

            if (token == '/') {
                added = true;
            } else if (token.match(/^([^#bx\d\s]+?)([#bx\s]*)(\d*)$/)) {
                var sym = RegExp.$1;
                var acc = RegExp.$2;
                var num = RegExp.$3;

                var quality = symbolMap[sym] ? symbolMap[sym] : nameMap[sym.toLowerCase()];
                var delta = getPitchDelta(acc);

                if (quality) {
                    if (num == '5') {
                        sequence.push({quality: quality, type: 'power', nth: 5, delta: delta});
                    } else if (num == '') {
                        var type = (delta == 0 ? 'TBD' : 'add');
                        sequence.push({quality: quality, type: type, delta: delta});
                    } else {
                        var nth = parseInt(num);

                        if (delta == 0 && nth % 2 == 1) {
                            sequence.push({quality: quality, type: 'fill', nth: nth, delta: delta});
                        } else {
                            sequence.push({quality: quality, type: 'add', nth: nth, delta: delta});
                            added = true;
                        }
                    }
                } else if (sym.match(/^sus(?:pended)?$/i)) {
                    var nth = (num == '' ? 4 : parseInt(num));
                    sequence.push({type: 'suspend', nth: nth, delta: delta});
                } else if (sym.match(/^add(?:ed)?$/i)) {
                    var nth = (num == '' ? 6 : parseInt(num));
                    sequence.push({type: 'add', nth: nth, delta: delta});
                    added = true;
                } else if (sym.match(/^alt(?:ered)?$/i)) {
                    var delta = getPitchDelta(acc, -1);
                    if (num == '') {
                        sequence.push({type: 'alter', delta: delta});
                    } else {
                        var nth = parseInt(num);
                        sequence.push({type: 'alter', nth: nth, delta: delta});
                    }
                }
            } else if (token.match(/^([#bnx\s]*)(\d+)$/)) {
                var acc = RegExp.$1;
                var num = RegExp.$2;

                var delta = getPitchDelta(acc);
                var nth = parseInt(num);

                if (delta == 0 && nth == 5) {
                    sequence.push({type: 'power', nth: nth, delta: delta});
                    added = true;
                } else if (!added && delta == 0 && nth % 2 == 1) {
                    sequence.push({quality: dominant, type: 'fill', nth: nth, delta: delta});
                } else {
                    sequence.push({type: 'add', nth: nth, delta: delta});
                    added = true;
                }
            }
        }

        // Determine quality for 'add'/'power'/'suspend'; Determine 'TBD' to be 'base'
        var lastQualityItem = null;

        for (var i = 0; i < sequence.length; i++) {
            var item = sequence[i];

            if ((item.type == 'add' || item.type == 'power' || item.type == 'suspend') && !item.quality) {
                if (lastQualityItem) {
                    item.quality = lastQualityItem.quality;

                    if ((item.type == 'add' || item.type == 'power') && lastQualityItem.type == 'TBD') {
                        lastQualityItem.type = 'base';
                    }
                } else {
                    item.quality = dominant;
                }
            }

            if (item.quality) {
                lastQualityItem = item;
            }
        }

        // Determine 'TBD' to be 'fill' with extended nth
        var maxFillNth = 3;
        var numFills = 0;

        for (var i = 0; i < sequence.length; i++) {
            var item = sequence[i];

            if (item.type == 'fill') {
                if (maxFillNth < item.nth) {
                    maxFillNth = item.nth;
                }
                numFills++;
            } else if (item.type == 'power') {
                if (maxFillNth < 7) {
                    maxFillNth = 7;
                }
                numFills++;
            } else if (item.type == 'TBD') {
                item.type = 'fill';
                item.nth = maxFillNth + 2;
                maxFillNth = item.nth;
                numFills++;
            }
        }

        var virtualFillNth;

        if (numFills == 0) {
            virtualFillNth = maxFillNth = 5;
        }

        for (var i = 0; i < sequence.length; i++) {
            var item = sequence[i];

            if (item.type == 'alter') {
                if (item.nth) {
                    if (maxFillNth < item.nth) {
                        virtualFillNth = maxFillNth = item.nth;
                    }
                } else {
                    item.nth = maxFillNth;
                }
            }
        }

        if (virtualFillNth) {
            sequence.unshift({quality: dominant, type: 'fill', nth: virtualFillNth});
        }

        return sequence;
    }

    function getChordIntervals(notation) {
        var sequence = getChordSequence(notation);

        var states = [];

        function setState(nth, item, enabled, forced) {
            if (forced || !states[nth - 1]) {
                var idx = (nth - 1) % 7;
                var octave = (nth - 1 - idx) / 7;
                
                var interval = item.quality.intervals[idx] + 12 * octave;
                var delta = 0;

                if (item.delta && nth == item.nth) {
                    delta = item.delta;
                }

                states[nth - 1] = {nth: nth, interval: interval, delta: delta, enabled: enabled};
            }
        }

        function alterState(nth, item) {
            if (states[nth - 1]) {
                states[nth - 1].delta = (nth == item.nth ? item.delta : -1);
            }
        }

        var nextFillNth = 1;

        for (var i = 0; i < sequence.length; i++) {
            var item = sequence[i];

            if (item.type == 'fill') {
                for (var n = nextFillNth; n <= item.nth; n++) {
                    setState(n, item, (n % 2 == 1), false);
                    nextFillNth = n + 1;
                }
            } else if (item.type == 'add') {
                setState(item.nth, item, true, true);
            } else if (item.type == 'power') {
                setState(1, item, true, false);
                setState(3, item, false, true);
                setState(5, item, true, true);
                setState(8, item, true, false);
            } else if (item.type == 'suspend') {
                setState(3, item, false, true);
                setState(item.nth, item, true, true);
            } else if (item.type == 'alter') {
                for (var n = 5; n <= item.nth; n++) {
                    alterState(n, item);
                }
            }
        }

        var intervals = [];

        for (var s = 0; s < states.length; s++) {
            if (states[s] && states[s].enabled) {
                intervals.push(states[s].interval + states[s].delta);
            }
        }

        return intervals;
    }

    function adjustBassChord(rootIndex, intervals, bassIndex) {
        var indices = [];

        for (var i = 0; i < intervals.length; i++) {
            indices.push(rootIndex + intervals[i]);
        }

        indices.sort();

        function shiftBassIndices(indices, bassIndex) {
            if (indices.length == 0) {
                return;
            }

            var rem = (indices[0] - bassIndex) % 12;
            var target = bassIndex + (rem < 0 ? rem + 12 : rem);
            var delta = target - indices[0];

            for (var i = 0; i < indices.length; i++) {
                indices[i] += delta;
            }
        }

        if (rootIndex != bassIndex && indices.length > 0) {
            var partition = 0;

            for (var i = 0; i < indices.length; i++) {
                var rem = (indices[i] - bassIndex) % 12;

                if (rem >= 0) {
                    partition = i;
                    break;
                }
            }

            var part1 = [];
            var part2 = [];

            for (var i = 0; i < indices.length; i++) {
                if (i < partition) {
                    part1.push(indices[i]);
                } else {
                    part2.push(indices[i]);
                }
            }

            shiftBassIndices(part1, bassIndex);
            shiftBassIndices(part2, bassIndex);

            if (part2[0] != bassIndex) {
                part2.unshift(bassIndex);
            }

            indices = part2.concat(part1);
            indices.sort();
        }

        return indices;
    }

    function getChord(note, options) {
        options = normalizeOptions(options);

        var frag = music.regexFrag;

        var regex = new RegExp(
            '(' + frag.pitch + ')\\s*' +
            '(' + frag.chordApprox + ')\\s*' +
            '(' + frag.chordBass + ')\\s*'
        );

        if (!note.match(regex)) {
            throw 'Invalid note: ' + note;
        }

        var rootNote = RegExp.$1;
        var notation = RegExp.$2;
        var bassNote = RegExp.$3;

        var rootIndex = getPitchIndex(rootNote, options, 3);
        var intervals = getChordIntervals(notation);
        var bassIndex = bassNote ? getPitchIndex(bassNote, options, 3) : rootIndex;

        var indices = adjustBassChord(rootIndex, intervals, bassIndex);

        var result = [];

        for (var i = 0; i < indices.length; i++) {
            result.push(formatNote(indices[i]));
        }

        return result.join(' ');
    }

    function enableKeyboardPiano(instCode) {
        setEvent('piano');

        if (typeof instCode == 'undefined') {
            instCode = 0;
        }

        var soundMap = [];

        soundMap[65] = 'C4' ; // A
        soundMap[87] = 'Db4'; // W
        soundMap[83] = 'D4' ; // S
        soundMap[69] = 'Eb4'; // E
        soundMap[68] = 'E4' ; // D

        soundMap[70] = 'F4' ; // F
        soundMap[84] = 'Gb4'; // T
        soundMap[71] = 'G4' ; // G
        soundMap[89] = 'Ab4'; // Y
        soundMap[72] = 'A4' ; // H
        soundMap[85] = 'Bb4'; // U
        soundMap[74] = 'B4' ; // J

        soundMap[75] = 'C5' ; // K
        soundMap[79] = 'Db5'; // O
        soundMap[76] = 'D5' ; // L
        soundMap[80] = 'Eb5'; // P
        soundMap[186] = 'E5'; // ;

        soundMap[222] = 'F5'; // '

        keyboardHook = function(event){
            initMusic();
            var fourth = 6/11;
            if (soundMap[event.keyCode]) {
                addSound(instCode, soundMap[event.keyCode], fourth);
            }
        };

        music.pianoMode = true;

        showInfo('キーボードによるピアノの演奏ができます。A/S/D/F → ド/レ/ミ/ファ');
    }

    function disableKeyboardPiano() {
        if (music.pianoMode) {
            music.pianoMode = false;
            keyboardHook = null;
            showComplete('キーボードによるピアノの演奏を終了しました。');
        }
    }

    function validateInstCode(value, required) {
        if (!required && value === undefined) {
            return;
        }
        if (typeof value != 'number' || value < 0 || value >= music.instruments.length || !music.instruments[value]) {
            throw "無効な楽器: " + formatInvalidInput(value);
        }
    }

    function wrapFunction(func) {
        return function () {
            try {
                setEvent('api');
                return func.apply(null, arguments);
            } catch (e) {
                console.error(e.toString ? e.toString() : e);
            }
        };
    }

    function setPublicAPI() {
        window.buy         = wrapFunction(buy);
        window.sell        = wrapFunction(sell);
        window.quote       = wrapFunction(quote);
        window.reset       = wrapFunction(reset);

        window.getPosition = wrapFunction(getPosition);
        window.getBalance  = wrapFunction(getBalance);
        window.getTotalPV  = wrapFunction(getTotalPV);
        window.getScore    = wrapFunction(getScore);
        window.getTrades   = wrapFunction(getTrades);

        window.cancel      = wrapFunction(cancel);
        window.update      = wrapFunction(update);
        window.isError     = wrapFunction(isError);

        window.setMission  = wrapFunction(setMission);

        window.S = numStocks;
        window.T = endTime;

        window.A = 0;
        window.B = 1;
        window.C = 2;

        window.BUY = BUY;
        window.SELL = SELL;

        if (lang == 'ja') {
            window.help = wrapFunction(function (target) {
                var name;

                if (arguments.length == 0) {
                    name = 'help';
                } else if (target == 'api' || target == 'api1') {
                    name = 'api1';
                } else if (target == 'api2') {
                    name = 'api2';
                } else if (target == 'api3') {
                    name = 'api3';
                } else if (target == 'music') {
                    name = 'm-help';
                } else if (target == 'music/example') {
                    name = 'm-example';
                } else if (target == 'music/api') {
                    name = 'm-api';
                } else if (target == 'music/time') {
                    name = 'm-time';
                } else {
                    throw '無効な引数: ' + formatInvalidInput(target);
                }

                setEvent('help', target);

                $.ajax({
                    url: 'docs/' + name + '.txt',
                    dataType: 'text'
                }).done(function (data) {
                    console.info(data);
                });

                return "ヘルプ";
            });

            window.sing = wrapFunction(function (target) {
                var name;

                if (arguments.length == 0) {
                    name = 's-db';
                } else if (target == 'daisy') {
                    name = 's-db';
                } else if (target == 'neko') {
                    name = 's-nf';
                } else {
                    throw '無効な引数: ' + formatInvalidInput(target);
                }

                setEvent('sing', target);

                $.ajax({
                    url: 'docs/' + name + '.js',
                    dataType: 'text'
                }).done(function (data) {
                    showInfo('スクリプトエディタにサンプルコードをロードしました。');
                    setScript(data);
                    executeScript();
                });
            });

            window.play = wrapFunction(function (instCode, notation, duration, options) {
                validateInstCode(instCode, true);
                validateString(notation, true);
                validateNumber(duration, true);
                validateObject(options, false);
                initMusic();
                return addSoundFlow(instCode, notation, duration, options);
            });

            window.play.addSound = wrapFunction(function (instCode, notation, duration, options) {
                validateInstCode(instCode, true);
                validateString(notation, true);
                validateNumber(duration, true);
                validateObject(options, false);
                initMusic();
                return addSound(instCode, notation, duration, options);
            });

            window.play.setDefault = wrapFunction(function (instCode) {
                validateInstCode(instCode, true);
                initMusic();
                return setDefaultSound.apply(null, arguments);
            });

            window.play.getTime = wrapFunction(function () {
                initMusic();
                return music.currentTime;
            });

            window.play.setTime = wrapFunction(function (time) {
                validateNumber(time, true);
                initMusic();
                music.currentTime = time;
            });

            window.play.moveTime = wrapFunction(function (duration) {
                validateNumber(duration, true);
                initMusic();
                music.currentTime += duration;
            });

            window.play.getChord = wrapFunction(function () {
                validateString(note, true);
                validateObject(options, false);
                initMusic();
                return getChord.apply(null, arguments);
            });

            window.play.getChordIntervals = wrapFunction(function () {
                validateString(notation, true);
                initMusic();
                return getChordIntervals.apply(null, arguments);
            });

            window.pianoMode = wrapFunction(function (instCode) {
                validateInstCode(instCode, false);
                initMusic();
                enableKeyboardPiano(instCode);
            });

            window.stopMusic = wrapFunction(function () {
                disableKeyboardPiano();
                stopMusic();
                reset();
            });
        }

        window.setScript = wrapFunction(function (text) {
            validateString(text, true); // text is required
            setScript(text);
        });

        window.getScript = wrapFunction(function (text) {
            return getScript();
        });

        window.executeScript = wrapFunction(function (text) {
            validateString(text, false); // text is optional
            executeScript(text);
        });

        window.editScript = wrapFunction(function () {
            editScript();
        });

        window.viewChart = wrapFunction(function () {
            viewChart();
        });

        window.viewTable = wrapFunction(function () {
            viewTable();
        });

        window.showInfo = wrapFunction(function (html, sticky) {
            validateString(html, true);
            showAlertPopup(html, false, sticky);
        });

        window.showError = wrapFunction(function (html, sticky) {
            validateString(html, true);
            showAlertPopup(html, true, sticky);
        });

        window.hideInfo = wrapFunction(function (delay, ifSticky) {
            validateNumber(delay, false);
            hideAlertPopup(delay, ifSticky);
        });

        window.hideError = wrapFunction(function (delay, ifSticky) {
            validateNumber(delay, false);
            hideAlertPopup(delay, ifSticky);
        });

        window.closeDialog = wrapFunction(function () {
            closeDialog();
        });
    }

    if (lang == 'ja') {
        console.info(
            "アルゴリズムバトルへようこそ！help() 関数を呼び出すと詳細が表示されます。\n"
        );
    }

    setPublicAPI();

    if (request.test) {
        $.ajax({
            url: 'tests/run-tests.js',
            dataType: 'text'
        }).done(function () {
            eval(arguments[0]);
        });
    }
});

(function () {
    var trackingID;
    if (location.host == 'internchallenge.morganstanley.co.jp') {
        trackingID = 'UA-120211034-1';
    } else if (location.host.match(/-uat/)) {
        trackingID = 'UA-120211034-2';
    } else if (location.host.match(/-qa/)) {
        trackingID = 'UA-120211034-3';
    } else {
        trackingID = 'UA-120211034-4';
    }
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () {
        dataLayer.push(arguments);
    };
    gtag('js', new Date());
    gtag('config', trackingID);
})();
