(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('tutorialDialog');
  const G = window.BeerGame;
  let page = 0, practice, result = null;
  const lessons = [
    {
      title: '你负责一站，目标是少花成本',
      content: '<p>你每周只需要决定：向上游订多少箱啤酒。收货、满足需求和记账会在确认订单后自动完成。</p>' +
        '<ol class="tutorial-chain"><li>顾客</li><li>零售商</li><li>批发商</li><li>分销商</li><li>工厂</li></ol>' +
        '<p>订单从顾客一侧传向工厂，啤酒从工厂一侧运回顾客。单人模式由 AI 管理另外三站；联机时由朋友接手。</p>' +
        '<div class="tutorial-example">不是订得越多越好：库存每箱每周花费 0.5，缺货每箱每周花费 1。目标是兼顾供货与成本。</div>'
    },
    {
      title: '先看四个数字，再决定下单',
      content: '<dl class="tutorial-facts"><div><dt>本周需求</dt><dd>这周要满足的新增订单。零售商面对顾客，其他角色面对已传来的下游订单。</dd></div>' +
        '<div><dt>库存</dt><dd>手上已有的啤酒。本周到货也会参与本周发货。</dd></div>' +
        '<div><dt>在途</dt><dd>正在运输、还没到手的货。近段本周结算到货，远段下周结算到货。</dd></div>' +
        '<div><dt>缺货</dt><dd>以前欠下、还没交付的订单。系统会接着补交，不需要把它当成新的顾客需求。</dd></div></dl>' +
        '<p>「订货参考」还会计算已订未发的货，避免你因为暂时没收到就重复订货。建议量可以是 0，也不保证最优。</p>'
    },
    {
      title: '今天下单，不会今天就到货',
      content: '<p>默认订单需要 1 周传到上游，货物发出后还需要 2 周运输。工厂的生产也需要 2 周。</p>' +
        '<ol class="tutorial-timeline"><li><strong>第 1 周</strong>你提交订单。</li><li><strong>第 2 周</strong>上游收到订单；有足够货物时发货。</li><li><strong>第 3 周</strong>货物仍在路上。</li><li><strong>第 4 周</strong>这批货在本周结算时到达你这里。</li></ol>' +
        '<p>这是默认设置且上游能及时供货的例子。额外订单延迟或上游缺货会让等待更久。不要因为一周没收到货，就不断加倍下单。</p>'
    },
    { title: '试着下第一笔订单', content: '' },
    { title: '读懂结算，就能开始了', content: '' }
  ];
  function render() {
    $('tutorialProgress').textContent = '新手教程 · ' + (page + 1) + ' / ' + lessons.length;
    $('tutorialTitle').textContent = lessons[page].title;
    $('tutorialPrevious').disabled = page === 0;
    $('tutorialNext').disabled = page === 3 && !result;
    $('tutorialNext').textContent = page === 4 ? '完成教程' : page === 3 ? '查看结算' : '下一步';
    $('tutorialContent').innerHTML = lessons[page].content;
    if (page === 3) {
      $('tutorialContent').innerHTML = '<p>练习中你是零售商：每周需求 4 箱，库存 12 箱，在途 8 箱（近、远段各 4）。试着订 4 箱，保持稳定补货；也可以试试 0–200 的其他整数。</p>' +
        '<div class="tutorial-example"><label for="tutorialOrder">练习订货量（箱）</label><div class="tutorial-order"><input id="tutorialOrder" type="number" min="0" max="200" step="1" value="4"><button id="tutorialSubmit" class="btn btn-primary" type="button">提交练习订单</button></div><p id="tutorialFeedback" role="status" aria-live="polite"></p></div>' +
        '<p>正式游戏中，先观察需求和在途，再填写订货量，最后点击「确认订单」。联机时所有玩家提交后才会结算，已提交的订单不能修改。</p>';
      if (result) {
        $('tutorialOrder').value = result.lastTurn.orders.retailer;
        $('tutorialFeedback').textContent = '已经提交，可查看结算，或换一个数量重新练习。';
      }
      $('tutorialSubmit').onclick = () => {
        const input = $('tutorialOrder');
        if (input.value.trim() === '' || !input.checkValidity()) {
          $('tutorialFeedback').textContent = '请输入 0–200 的整数箱数。'; input.focus(); return;
        }
        result = G.step(practice, Number(input.value));
        $('tutorialFeedback').textContent = '练习订单 ' + Number(input.value) + ' 箱已提交。点击「查看结算」看看这一周发生了什么。';
        $('tutorialNext').disabled = false;
      };
    }
    if (page === 4) {
      const role = result.roles.retailer;
      $('tutorialContent').innerHTML = '<p>你订了 <strong>' + result.lastTurn.orders.retailer + ' 箱</strong>。本周先收到原本在途的 4 箱，再交付顾客需要的 4 箱。</p>' +
        '<div class="tutorial-example">期末库存：12 + 4 − 4 = <strong>' + role.inventory + ' 箱</strong><br>期末缺货：<strong>' + role.backlog + ' 箱</strong><br>本周成本：12 × 0.5 + 0 × 1 = <strong>' + role.totalCost + '</strong></div>' +
        '<p>这周新下的订单还没到，所以订多订少都不会立即改变本周库存。它的影响会在后面的周期逐步出现。</p>' +
        '<p>接下来留意「成本趋势」和「订货参考」。需求突然上升时，先检查在途与已订未发，避免反复加单把波动传到上游，这就是牛鞭效应。</p>' +
        '<p>第一次正式玩，可以选择零售商、稳定需求和 18 周期。教程结束后会回到原来的页面，你可以随时重看。</p>';
    }
    $('tutorialTitle').focus();
    dialog.scrollTop = 0;
  }
  $('tutorialOpen').onclick = () => {
    page = 0; result = null;
    practice = G.createGame({playerRole:'retailer', demandMode:'stable', demandStart:4, initialInventory:12, initialPipeline:4, periods:18, botLevel:'normal'});
    dialog.showModal(); render();
  };
  $('tutorialClose').onclick = () => dialog.close();
  $('tutorialPrevious').onclick = () => { if (page > 0) { page--; render(); } };
  $('tutorialNext').onclick = () => {
    if (page === 3 && !result) return;
    if (page === lessons.length - 1) dialog.close(); else { page++; render(); }
  };
  dialog.addEventListener('close', () => $('tutorialOpen').focus());
})();
