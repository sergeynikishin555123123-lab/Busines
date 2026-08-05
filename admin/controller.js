// admin/controller.js
// КОНТРОЛЛЕР АДМИНИСТРАТОРОВ

const database = require('../database');
const logger = require('../logger');
const bcrypt = require('bcryptjs');

class AdminController {
    static async getAllAdmins() {
        try {
            return database.readTable('admins');
        } catch (error) {
            logger.error({ err: error }, 'Error fetching admins');
            throw error;
        }
    }

    static async getAdminById(adminId) {
        try {
            const admins = database.readTable('admins');
            return admins.find(a => a.id === adminId) || null;
        } catch (error) {
            logger.error({ err: error }, 'Error fetching admin');
            throw error;
        }
    }

    static async createAdmin(login, password, role = 'admin') {
        try {
            const admins = database.readTable('admins');

            if (admins.find(a => a.login === login)) {
                throw new Error('Admin with this login already exists');
            }

            const passwordHash = await bcrypt.hash(password, 12);

            const newAdmin = {
                id: database.generateId(),
                login: login,
                password_hash: passwordHash,
                role: role || 'admin',
                created_at: database.now(),
            };

            admins.push(newAdmin);
            database.writeTable('admins', admins);

            logger.info({ login, role }, 'Admin created successfully');
            return newAdmin;

        } catch (error) {
            logger.error({ err: error, login }, 'Error creating admin');
            throw error;
        }
    }

    static async updateAdminPassword(adminId, newPassword) {
        try {
            const admins = database.readTable('admins');
            const adminIndex = admins.findIndex(a => a.id === adminId);

            if (adminIndex === -1) {
                throw new Error('Admin not found');
            }

            const passwordHash = await bcrypt.hash(newPassword, 12);
            admins[adminIndex].password_hash = passwordHash;
            database.writeTable('admins', admins);

            logger.info({ adminId }, 'Admin password updated successfully');
            return true;

        } catch (error) {
            logger.error({ err: error, adminId }, 'Error updating admin password');
            throw error;
        }
    }

    static async deleteAdmin(adminId) {
        try {
            let admins = database.readTable('admins');
            const admin = admins.find(a => a.id === adminId);

            if (!admin) {
                throw new Error('Admin not found');
            }

            const superAdmins = admins.filter(a => a.role === 'superadmin');
            if (admin.role === 'superadmin' && superAdmins.length <= 1) {
                throw new Error('Cannot delete last superadmin');
            }

            admins = admins.filter(a => a.id !== adminId);
            database.writeTable('admins', admins);

            logger.info({ adminId }, 'Admin deleted successfully');
            return true;

        } catch (error) {
            logger.error({ err: error, adminId }, 'Error deleting admin');
            throw error;
        }
    }

    static async authenticate(login, password) {
        try {
            const admins = database.readTable('admins');
            const admin = admins.find(a => a.login === login);

            if (!admin) {
                return null;
            }

            const isValid = await bcrypt.compare(password, admin.password_hash);
            if (!isValid) {
                return null;
            }

            return admin;

        } catch (error) {
            logger.error({ err: error, login }, 'Error authenticating admin');
            throw error;
        }
    }

    static async changePassword(adminId, oldPassword, newPassword) {
        try {
            const admin = await this.getAdminById(adminId);
            if (!admin) {
                throw new Error('Admin not found');
            }

            const isValid = await bcrypt.compare(oldPassword, admin.password_hash);
            if (!isValid) {
                throw new Error('Current password is incorrect');
            }

            return await this.updateAdminPassword(adminId, newPassword);

        } catch (error) {
            logger.error({ err: error, adminId }, 'Error changing password');
            throw error;
        }
    }

    static async updateRole(adminId, newRole) {
        try {
            const admins = database.readTable('admins');
            const adminIndex = admins.findIndex(a => a.id === adminId);

            if (adminIndex === -1) {
                throw new Error('Admin not found');
            }

            const superAdmins = admins.filter(a => a.role === 'superadmin');
            if (admins[adminIndex].role === 'superadmin' && superAdmins.length <= 1) {
                throw new Error('Cannot change role of last superadmin');
            }

            admins[adminIndex].role = newRole;
            database.writeTable('admins', admins);

            logger.info({ adminId, newRole }, 'Admin role updated');
            return admins[adminIndex];

        } catch (error) {
            logger.error({ err: error, adminId }, 'Error updating role');
            throw error;
        }
    }
}

module.exports = AdminController;
