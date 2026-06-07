(function() {
  function getCart() {
    try { return JSON.parse(localStorage.getItem('mx_cart') || '[]'); } catch { return []; }
  }
  function saveCart(cart) {
    localStorage.setItem('mx_cart', JSON.stringify(cart));
    updateCartCount();
    renderCartItems();
  }
  function updateCartCount() {
    var cart = getCart();
    var count = cart.reduce(function(sum, i) { return sum + i.qty; }, 0);
    var badges = document.querySelectorAll('.cart-count');
    badges.forEach(function(b) {
      b.textContent = count;
      b.style.display = count > 0 ? 'flex' : 'none';
    });
  }
  window.addToCart = function(item) {
    var cart = getCart();
    var existing = cart.find(function(i) { return i.stripePrice === item.stripePrice; });
    if (existing) {
      existing.qty += item.qty;
    } else {
      cart.push(item);
    }
    saveCart(cart);
    openCart();
  };
  window.removeFromCart = function(stripePrice) {
    var cart = getCart().filter(function(i) { return i.stripePrice !== stripePrice; });
    saveCart(cart);
  };
  window.updateQty = function(stripePrice, delta) {
    var cart = getCart();
    var item = cart.find(function(i) { return i.stripePrice === stripePrice; });
    if (item) {
      item.qty = Math.max(1, item.qty + delta);
    }
    saveCart(cart);
  };
  window.openCart = function() {
    document.getElementById('cartDrawer').classList.add('open');
    document.getElementById('cartOverlay').classList.add('open');
  };
  window.closeCart = function() {
    document.getElementById('cartDrawer').classList.remove('open');
    document.getElementById('cartOverlay').classList.remove('open');
  };
  function renderCartItems() {
    var cart = getCart();
    var el = document.getElementById('cartItems');
    var totalEl = document.getElementById('cartTotal');
    var checkoutBtn = document.getElementById('cartCheckoutBtn');
    if (!el) return;
    if (cart.length === 0) {
      el.innerHTML = '<p class="cart-empty">Your cart is empty</p>';
      if (totalEl) totalEl.textContent = '$0.00';
      if (checkoutBtn) checkoutBtn.disabled = true;
      return;
    }
    var total = 0;
    el.innerHTML = cart.map(function(item) {
      var lineTotal = (item.priceCents * item.qty / 100).toFixed(2);
      total += item.priceCents * item.qty;
      return '<div class="cart-item" data-price="' + item.stripePrice + '">' +
        '<div class="cart-item-info">' +
          '<div class="cart-item-name">' + item.name + '</div>' +
          '<div class="cart-item-sub">' + item.category + '</div>' +
        '</div>' +
        '<div class="cart-item-controls">' +
          '<button class="cart-qty-btn" onclick="updateQty(\'' + item.stripePrice + '\', -1)">−</button>' +
          '<span class="cart-qty-num">' + item.qty + '</span>' +
          '<button class="cart-qty-btn" onclick="updateQty(\'' + item.stripePrice + '\', 1)">+</button>' +
        '</div>' +
        '<div class="cart-item-price">$' + lineTotal + '</div>' +
        '<button class="cart-remove" onclick="removeFromCart(\'' + item.stripePrice + '\')">✕</button>' +
      '</div>';
    }).join('');
    if (totalEl) totalEl.textContent = '$' + (total / 100).toFixed(2);
    if (checkoutBtn) checkoutBtn.disabled = false;
  }
  window.cartCheckout = async function() {
    var cart = getCart();
    if (cart.length === 0) return;
    var btn = document.getElementById('cartCheckoutBtn');
    var name = document.getElementById('cartName') ? document.getElementById('cartName').value.trim() : '';
    var email = document.getElementById('cartEmail') ? document.getElementById('cartEmail').value.trim() : '';
    if (!name || !email) { alert('Please enter your name and email.'); return; }
    if (!email.includes('@')) { alert('Please enter a valid email.'); return; }
    btn.disabled = true;
    btn.textContent = 'Redirecting...';
    try {
      var res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cart: cart, customerName: name, customerEmail: email }),
      });
      var data = await res.json();
      if (data.url) {
        localStorage.removeItem('mx_cart');
        window.location.href = data.url;
      } else { throw new Error(data.error || 'Checkout failed'); }
    } catch(err) {
      alert('Something went wrong. Please try again.');
      btn.disabled = false;
      btn.textContent = 'Checkout';
    }
  };
  document.addEventListener('DOMContentLoaded', function() {
    updateCartCount();
    renderCartItems();
  });
})();
