// frappe.Chat
// Author - Nihal Mittal <nihal@erpnext.com>

import {
  ChatBubble,
  ChatList,
  ChatSpace,
  ChatWelcome,
  get_settings,
  scroll_to_bottom,
} from './components';
frappe.provide('frappe.Chat');
frappe.provide('frappe.Chat.settings');

/** Spawns a chat widget on any web page */
frappe.Chat = class {
  constructor() {
    this.setup_app();
  }

  /** Create all the required elements for chat widget */
  create_app() {
    this.$app_element = $(document.createElement('div'));
    this.$app_element.addClass('chat-app');
    this.$chat_container = $(document.createElement('div'));
    this.$chat_container.addClass('chat-container');
    $('body').append(this.$app_element);
    this.is_open = false;

    this.$chat_element = $(document.createElement('div'))
      .addClass('chat-element')
      .hide();

    this.$chat_element.append(`
			<span class="chat-cross-button">
				${frappe.utils.icon('close', 'lg')}
			</span>
		`);
    this.$chat_element.append(this.$chat_container);
    this.$chat_element.appendTo(this.$app_element);

    this.chat_bubble = new ChatBubble(this);
    this.chat_bubble.render();

    if (this.is_desk === true) {
      this.mount_desk_icon();
    }
    this.setup_events();
  }

  /**
   * Put the chat's entry point somewhere the user can actually click it.
   *
   * Frappe v16 rewrote the desk shell. There is no top navbar any more --
   * `desk.html` ships an empty `<header>`, and the navbar template is only
   * rendered on mobile or for the announcement bar, and even then carries no
   * `header.navbar`. So the single selector this used to prepend to,
   * `header.navbar > .container > .navbar-collapse > ul`, matches nothing on
   * v16 and `.prepend()` is a silent no-op. Since the floating bubble is
   * deliberately hidden inside the desk (ChatBubble adds `d-none` when
   * `is_desk`), that left no way into the chat at all: no icon, no window.
   *
   * v16's equivalent of that navbar icon row is the sidebar's standard-items
   * band, the strip holding Search and Notifications. Mount there when it
   * exists, keep the v15 navbar for the older shell, and if neither shell is
   * recognised fall back to the floating bubble -- an out-of-place bubble beats
   * an unreachable chat, and it keeps the next shell rewrite from hiding the
   * app again.
   */
  async mount_desk_icon() {
    const badge_html = `<span class="badge" id="chat-notification-count"></span>`;

    // v15 and earlier: the top navbar.
    const $navbar_list = $(
      'header.navbar > .container > .navbar-collapse > ul'
    );
    if ($navbar_list.length) {
      $navbar_list.prepend(`
        <li class='nav-item dropdown dropdown-notifications
          dropdown-mobile chat-navbar-icon' title="Show Chats" >
          ${frappe.utils.icon('small-message', 'md')}
          ${badge_html}
        </li>
      `);
      return 'navbar';
    }

    // v16: a row in the sidebar's standard-items band, built by the desk's own
    // sidebar-item renderer so it looks and behaves like Search and
    // Notifications rather than like something glued on.
    const sidebar = await this.get_desk_sidebar();
    if (sidebar) {
      sidebar.add_item(sidebar.$standard_items_band, {
        label: __('WhatsApp'),
        icon: 'small-message',
        standard: true,
        type: 'Button',
        // TypeButton replaces the wrapper's class attribute outright, so the
        // container class the sidebar styles rows by has to be repeated here.
        class: 'sidebar-item-container chat-navbar-icon',
        suffix: badge_html,
      });
      return 'sidebar';
    }

    // Unrecognised shell: show the bubble instead of nothing.
    this.$app_element.find('.chat-bubble').removeClass('d-none');
    return 'bubble';
  }

  /**
   * The desk sidebar, once it exists.
   *
   * `create_app()` runs after an awaited settings call, so the sidebar is
   * normally built by then. It is not guaranteed -- a slow boot or a cached
   * settings response can land first -- so wait a bounded moment rather than
   * either assuming it or giving up instantly. Returns null if it never
   * appears, which sends the caller to the bubble.
   */
  async get_desk_sidebar(timeout = 10000, interval = 100) {
    const is_ready = () =>
      frappe.app &&
      frappe.app.sidebar &&
      frappe.app.sidebar.$standard_items_band &&
      frappe.app.sidebar.$standard_items_band.length
        ? frappe.app.sidebar
        : null;

    const deadline = Date.now() + timeout;
    let sidebar = is_ready();
    while (!sidebar && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      sidebar = is_ready();
    }
    return sidebar;
  }

  /** Load dependencies and fetch the settings */
  async setup_app() {
    try {
      const token = localStorage.getItem('guest_token') || '';
      const res = await get_settings(token);
      this.is_admin = res.is_admin;
      this.is_desk = 'desk' in frappe;

      if (res.enable_chat === false || (!this.is_desk && this.is_admin)) {
        return;
      }

      this.create_app();
      await frappe.socketio.init(res.socketio_port);

      frappe.Chat.settings = {};
      frappe.Chat.settings.user = res.user_settings;
      frappe.Chat.settings.unread_count = 0;

      if (res.is_admin) {
        // If the user is admin, render everthing
        this.chat_list = new ChatList({
          $wrapper: this.$chat_container,
          user: res.user,
          user_email: res.user_email,
          is_admin: res.is_admin,
        });
        this.chat_list.render();
      } else if (res.is_verified) {
        // If the token and ip address matches, directly render the chat space
        this.chat_space = new ChatSpace({
          $wrapper: this.$chat_container,
          profile: {
            room_name: res.guest_title,
            room: res.room,
            is_admin: res.is_admin,
            user: res.user,
            user_email: res.user_email,
          },
        });
      } else {
        //Render the welcome screen if the user is not verified
        this.chat_welcome = new ChatWelcome({
          $wrapper: this.$chat_container,
          profile: {
            name: res.guest_title,
            is_admin: res.is_admin,
            chat_status: res.chat_status,
          },
        });
        this.chat_welcome.render();
      }
    } catch (error) {
      console.error(error);
    }
  }

  /** Shows the chat widget */
  show_chat_widget() {
    this.is_open = true;
    this.$chat_element.fadeIn(250);
    if (typeof this.chat_space !== 'undefined') {
      scroll_to_bottom(this.chat_space.$chat_space_container);
    }
  }

  /** Hides the chat widget */
  hide_chat_widget() {
    this.is_open = false;
    this.$chat_element.fadeOut(300);
  }

  should_close(e) {
    const chat_app = $('.chat-app');
    const navbar = $('.navbar');
    const modal = $('.modal');
    // The icon is its own toggle, so a click on it must not also count as a
    // click away. On v15 the navbar check covered that, because the icon lived
    // in the navbar; in v16's sidebar it does not, and without this the
    // mouseup closes the window a moment before the click reopens it.
    if ($(e.target).closest('.chat-navbar-icon').length) {
      return false;
    }
    return (
      !chat_app.is(e.target) &&
      chat_app.has(e.target).length === 0 &&
      !navbar.is(e.target) &&
      navbar.has(e.target).length === 0 &&
      !modal.is(e.target) &&
      modal.has(e.target).length === 0
    );
  }

  setup_events() {
    const me = this;
    // Delegated, because the icon is mounted asynchronously on v16 (the
    // sidebar may not exist yet) and so may appear after this runs. It also
    // keeps exactly one handler no matter which shell mounted it, which a
    // direct `.on()` per mount point would not.
    $(document)
      .off('click.whatsapp-chat-icon')
      .on('click.whatsapp-chat-icon', '.chat-navbar-icon', function () {
        me.chat_bubble.change_bubble();
      });

    $(document).mouseup(function (e) {
      if (me.should_close(e) && me.is_open === true) {
        me.chat_bubble.change_bubble();
      }
    });
  }
};

$(function () {
  new frappe.Chat();
});
