import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {WorkspaceBackground} from 'resource:///org/gnome/shell/ui/workspace.js';

/**
 * Makes each workspace card's own Meta.BackgroundActor show a screen-aligned
 * 1:1 crop of the wallpaper.
 *
 * Instead of adding a full-screen sharp layer and masking it with a shader,
 * this registry enlarges the background actor that the card already owns to
 * the monitor size, positions it so its texture maps 1:1 onto the screen, and
 * lets the card's own rectangular clip limit the visible part. The actor is
 * reallocated directly, so the card's preferred size and workspace layout are
 * not changed.
 *
 * In the app grid the actor is put back to its native card-sized geometry and
 * the native rounded clip, so each card shows its own scaled wallpaper again.
 */
export class CardRegistry {
    constructor(manager) {
        this._manager = manager;
        this._records = new Map();
        this._enabled = true;
        // True while the window picker should show the 1:1 crop. False means
        // the native card wallpaper is in charge (app grid, setting off).
        this._crop = false;
        this._scaleFactor = 1;

        try {
            this._scaleFactor =
                St.ThemeContext.get_for_stage(global.stage).scaleFactor;
        } catch {
            // The stage may not exist yet during early startup.
        }
    }

    register(background) {
        if (!this._enabled || !background)
            return;

        let record = this._records.get(background);
        if (!record) {
            record = {
                background,
                actor: null,
                content: null,
                crop: false,
                cropBox: null,
                cropScale: 1,
                clipX: 0,
                clipY: 0,
                clipWidth: 0,
                clipHeight: 0,
                clipRadius: 0,
                reapplyingAllocation: false,
                reapplyingClip: false,
                signals: [],
                parentSignals: [],
                actorSignals: [],
                contentSignals: [],
                parent: null,
            };
            this._records.set(background, record);
        }

        this._connectBackgroundSignals(record);
        this._bindManagerSignals(record);
        this._bindActor(record);
        this._attachParentSignals(record);

        if (this._crop)
            this._applyCrop(record);
    }

    scan() {
        if (!this._enabled)
            return;

        const overviewGroup = Main.layoutManager.overviewGroup;
        if (!overviewGroup)
            return;

        this._scanActor(overviewGroup);

        // Parents are usually available after the views have been built.
        for (const record of this._records.values()) {
            this._attachParentSignals(record);
            this._bindActor(record);
        }
    }

    _scanActor(actor) {
        if (!actor)
            return;

        for (const child of actor.get_children()) {
            if (child instanceof WorkspaceBackground)
                this.register(child);
            else
                this._scanActor(child);
        }
    }

    /**
     * Switch between the sharp crop (window picker) and the native card
     * wallpaper (app grid).
     *
     * @param {number} amount 0 = sharp crop, 1 = native app grid wallpaper
     */
    setNativeAmount(amount) {
        const crop = amount < 1;
        if (crop === this._crop)
            return;

        this._crop = crop;

        for (const record of this._records.values()) {
            if (crop)
                this._applyCrop(record);
            else
                this._restoreNative(record);
        }
    }

    /**
     * Recompute the crop for every card. Called once per compositor frame
     * while the overview animates.
     */
    update() {
        if (!this._enabled || !this._crop)
            return;

        this._scaleFactor =
            St.ThemeContext.get_for_stage(global.stage).scaleFactor;

        for (const record of this._records.values())
            this._applyCrop(record);
    }

    _applyCrop(record) {
        const background = record.background;
        const group = background._backgroundGroup;
        const actor = background._bgManager?.backgroundActor ?? null;

        if (!group || !actor)
            return;

        const monitor = Main.layoutManager.monitors[background._monitorIndex];
        if (!monitor || group.width < 1 || group.height < 1)
            return;

        let cardTopLeft, cardBottomRight, cardWidth = 0;
        try {
            const box = background.get_allocation_box();
            cardWidth = box.get_width();
            cardTopLeft = background.apply_relative_transform_to_point(
                null, ORIGIN_POINT);
            BOTTOM_RIGHT_POINT.x = box.get_width();
            BOTTOM_RIGHT_POINT.y = box.get_height();
            cardBottomRight = background.apply_relative_transform_to_point(
                null, BOTTOM_RIGHT_POINT);
        } catch {
            return;
        }

        const width = cardBottomRight.x - cardTopLeft.x;
        const height = cardBottomRight.y - cardTopLeft.y;
        if (width < 1 || height < 1)
            return;

        // The workspace layout may scale the card. Use the group's own
        // transform, not the card allocation, because the background group can
        // be offset inside the card by the shell's layout.
        let groupTopLeft, groupBottomRight;
        try {
            groupTopLeft = group.apply_relative_transform_to_point(
                null, ORIGIN_POINT);
            GROUP_BOTTOM_RIGHT_POINT.x = group.width;
            GROUP_BOTTOM_RIGHT_POINT.y = group.height;
            groupBottomRight = group.apply_relative_transform_to_point(
                null, GROUP_BOTTOM_RIGHT_POINT);
        } catch {
            return;
        }

        const groupWidth = groupBottomRight.x - groupTopLeft.x;
        if (groupWidth < 1)
            return;

        const groupScale = groupWidth / group.width;
        if (!Number.isFinite(groupScale) || groupScale <= 0)
            return;

        const cropScale = 1 / groupScale;
        const x1 = (monitor.x - groupTopLeft.x) / groupScale;
        const y1 = (monitor.y - groupTopLeft.y) / groupScale;
        const x2 = x1 + monitor.width;
        const y2 = y1 + monitor.height;

        record.crop = true;

        const boxChanged = !record.cropBox ||
            Math.abs(record.cropBox.x1 - x1) > 0.01 ||
            Math.abs(record.cropBox.y1 - y1) > 0.01 ||
            Math.abs(record.cropBox.x2 - x2) > 0.01 ||
            Math.abs(record.cropBox.y2 - y2) > 0.01;
        const scaleChanged = Math.abs(record.cropScale - cropScale) > 0.0001;

        if (scaleChanged) {
            actor.set_pivot_point(0, 0);
            actor.set_scale(cropScale, cropScale);
            record.cropScale = cropScale;
        }

        if (boxChanged) {
            record.cropBox = new Clutter.ActorBox({x1, y1, x2, y2});
            try {
                actor.allocate(record.cropBox);
            } catch {
                // The actor may be between map/unmap; the next update retries.
            }
        }

        // The wallpaper texture is mapped 1:1 onto the monitor, so the
        // rounded clip is the card rectangle in monitor coordinates.
        const clipX = cardTopLeft.x - monitor.x;
        const clipY = cardTopLeft.y - monitor.y;
        const state = background._stateAdjustment?.value ?? 1;
        const radius = this._manager.getCornerRadius() * state *
            (width / Math.max(1, cardWidth)) * this._scaleFactor;

        this._setClip(record, clipX, clipY, width, height, radius);
    }

    _setClip(record, x, y, width, height, radius) {
        const content = record.content;
        if (!content)
            return;

        const bounds = new Graphene.Rect();
        bounds.origin.x = x;
        bounds.origin.y = y;
        bounds.size.width = width;
        bounds.size.height = height;

        const changed = !record.clipBounds ||
            Math.abs(record.clipX - x) > 0.01 ||
            Math.abs(record.clipY - y) > 0.01 ||
            Math.abs(record.clipWidth - width) > 0.01 ||
            Math.abs(record.clipHeight - height) > 0.01 ||
            Math.abs(record.clipRadius - radius) > 0.01;

        if (!changed)
            return;

        record.clipX = x;
        record.clipY = y;
        record.clipWidth = width;
        record.clipHeight = height;
        record.clipRadius = radius;
        record.clipBounds = bounds;

        record.reapplyingClip = true;
        try {
            content.set_rounded_clip_bounds(bounds);
            content.rounded_clip_radius = radius;
        } catch {
            // Content may already be disposed.
        }
        record.reapplyingClip = false;
    }

    _restoreNative(record) {
        record.crop = false;
        record.cropBox = null;
        record.cropScale = 1;
        record.clipBounds = null;

        const background = record.background;
        const group = background._backgroundGroup;
        const actor = record.actor ??
            background._bgManager?.backgroundActor ?? null;

        if (actor) {
            try {
                actor.set_pivot_point(0, 0);
                actor.set_scale(1, 1);
            } catch {
                // Actor may already be disposed.
            }
        }

        // Let the card's own BinLayout allocate the actor again. Allocating
        // it by hand would use the rounded group size and can differ from the
        // shell's allocation by a fraction of a pixel.
        try {
            group?.queue_relayout();
            background._bin?.queue_relayout();
        } catch {
            // Actor may already be disposed.
        }

        // Let the shell and Blur My Shell restore their own rounded clip. Both
        // methods are safe to call repeatedly.
        try {
            background._updateRoundedClipBounds?.();
            background._updateBorderRadius?.();
        } catch {
            // Private API changed; the native values will be restored by the
            // next shell update.
        }
    }

    _connectBackgroundSignals(record) {
        if (record.signals.length > 0)
            return;

        const background = record.background;
        const schedule = () => this._manager.scheduleUpdate();

        this._connect(record.signals, background, 'notify::allocation', schedule);
        this._connect(record.signals, background, 'destroy', () => {
            this._disconnectAll(record);
            this._disconnectParent(record);
            this._records.delete(background);
            this._manager.scheduleUpdate();
        });
    }

    _bindManagerSignals(record) {
        const manager = record.background._bgManager;
        if (!manager || record.managerSignalId)
            return;

        try {
            record.managerSignalId = manager.connect('changed', () => {
                this._bindActor(record);
                this._manager.scheduleUpdate();
            });
        } catch {
            record.managerSignalId = 0;
        }
    }

    _bindActor(record) {
        const actor = record.background._bgManager?.backgroundActor ?? null;
        if (record.actor === actor)
            return;

        this._disconnectActor(record);
        record.actor = actor;
        // A new actor starts with native geometry; force the crop values to be
        // applied again instead of comparing against the previous actor's.
        record.cropScale = 1;
        record.cropBox = null;
        record.clipBounds = null;
        if (!actor)
            return;

        this._connect(record.actorSignals, actor, 'notify::allocation',
            () => this._onActorAllocation(record));
        this._connect(record.actorSignals, actor, 'destroy', () => {
            if (record.actor === actor) {
                record.actor = null;
                record.content = null;
            }
        });

        const content = actor.content ?? null;
        record.content = content;
        if (!content)
            return;

        this._connect(record.contentSignals, content,
            'notify::rounded-clip-radius', () => this._onClipChanged(record));
    }

    _onActorAllocation(record) {
        if (!record.crop || record.reapplyingAllocation || !record.cropBox)
            return;

        const actor = record.actor;
        if (!actor)
            return;

        let allocation;
        try {
            allocation = actor.get_allocation_box();
        } catch {
            return;
        }

        if (this._sameBox(allocation, record.cropBox))
            return;

        record.reapplyingAllocation = true;
        try {
            actor.allocate(record.cropBox);
        } catch {
            // The actor may be between map/unmap; the next update retries.
        }
        record.reapplyingAllocation = false;
    }

    _onClipChanged(record) {
        if (!record.crop || record.reapplyingClip || !record.clipBounds)
            return;

        const content = record.content;
        if (!content)
            return;

        record.reapplyingClip = true;
        try {
            content.set_rounded_clip_bounds(record.clipBounds);
            content.rounded_clip_radius = record.clipRadius;
        } catch {
            // Content may already be disposed.
        }
        record.reapplyingClip = false;
    }

    _sameBox(a, b) {
        return Math.abs(a.x1 - b.x1) <= 0.01 &&
            Math.abs(a.y1 - b.y1) <= 0.01 &&
            Math.abs(a.x2 - b.x2) <= 0.01 &&
            Math.abs(a.y2 - b.y2) <= 0.01;
    }

    _attachParentSignals(record) {
        let parent;
        try {
            parent = record.background.get_parent();
        } catch {
            return;
        }

        if (!parent || parent === record.parent)
            return;

        this._disconnectParent(record);
        record.parent = parent;

        const schedule = () => this._manager.scheduleUpdate();

        this._connect(record.parentSignals, parent, 'notify::scale-x', schedule);
        this._connect(record.parentSignals, parent, 'notify::scale-y', schedule);
        this._connect(record.parentSignals, parent, 'notify::opacity', schedule);
        this._connect(record.parentSignals, parent, 'notify::visible', schedule);
        this._connect(record.parentSignals, parent, 'notify::allocation', schedule);
    }

    _connect(list, object, signal, callback) {
        try {
            list.push([object, object.connect(signal, callback)]);
        } catch {
            // Actor already destroyed.
        }
    }

    _disconnectActor(record) {
        for (const [object, id] of record.actorSignals) {
            try {
                object.disconnect(id);
            } catch {
                // Already destroyed.
            }
        }
        record.actorSignals = [];

        for (const [object, id] of record.contentSignals) {
            try {
                object.disconnect(id);
            } catch {
                // Already destroyed.
            }
        }
        record.contentSignals = [];

        record.actor = null;
        record.content = null;
    }

    _disconnectAll(record) {
        for (const [object, id] of record.signals) {
            try {
                object.disconnect(id);
            } catch {
                // Already destroyed.
            }
        }
        record.signals = [];

        const manager = record.background._bgManager;
        if (manager && record.managerSignalId) {
            try {
                manager.disconnect(record.managerSignalId);
            } catch {
                // Already destroyed.
            }
        }
        record.managerSignalId = 0;

        this._disconnectActor(record);
    }

    _disconnectParent(record) {
        for (const [object, id] of record.parentSignals) {
            try {
                object.disconnect(id);
            } catch {
                // Already destroyed.
            }
        }
        record.parentSignals = [];
        record.parent = null;
    }

    destroy() {
        this._enabled = false;

        for (const record of this._records.values()) {
            this._disconnectAll(record);
            this._disconnectParent(record);
            this._restoreNative(record);
        }

        this._records.clear();
    }
}

// Reused for geometry queries; apply_relative_transform_to_point() reads them
// synchronously and returns new points, so sharing them is safe.
const ORIGIN_POINT = new Graphene.Point3D({x: 0, y: 0, z: 0});
const BOTTOM_RIGHT_POINT = new Graphene.Point3D({x: 0, y: 0, z: 0});
const GROUP_BOTTOM_RIGHT_POINT = new Graphene.Point3D({x: 0, y: 0, z: 0});
